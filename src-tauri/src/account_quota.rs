//! Profile-scoped, allowlisted account quota snapshots and native retry policy.
//!
//! The CLI output is treated as untrusted provider data: only explicitly
//! selected fields leave this module, and provider metadata is never returned.

use std::process::Stdio;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::child_run::{collect, WaitError};
use crate::supervisor::ProcessSupervisor;

const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const STDERR_LIMIT: usize = 8 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
static POLICY_LOCK: Mutex<()> = Mutex::new(());
const USAGE_AWARE_KEY: &str = "retry.usageAwareFallback";
const RESERVE_KEY: &str = "retry.usageReservePct";
const MODEL_FALLBACK_KEY: &str = "retry.modelFallback";

/// Quota data that is safe to expose to the application webview.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub generated_at: Option<u64>,
    pub reports: Vec<QuotaReport>,
    pub accounts_without_usage: Vec<AccountSummary>,
    pub disabled_credentials: Vec<AccountSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReport {
    pub provider: Option<String>,
    pub fetched_at: Option<u64>,
    pub account: Option<AccountSummary>,
    pub limits: Vec<QuotaLimit>,
    pub error: Option<String>,
}

/// Only account identity labels are retained. Raw CLI `metadata` is discarded.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub provider: Option<String>,
    pub id: Option<String>,
    pub organization: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaLimit {
    pub id: Option<String>,
    pub label: Option<String>,
    pub scope: Option<QuotaScope>,
    pub window: Option<QuotaWindow>,
    pub amount: Option<QuotaAmount>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaScope {
    pub provider: Option<String>,
    pub account_id: Option<String>,
    pub organization_id: Option<String>,
    pub model_id: Option<String>,
    pub tier: Option<String>,
    pub window_id: Option<String>,
    pub shared: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub id: Option<String>,
    pub label: Option<String>,
    pub duration_ms: Option<u64>,
    pub resets_at: Option<u64>,
}

/// Numeric fields from omp's normalized `UsageAmount`. `None` means the
/// provider did not report that measure, not that it is zero.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaAmount {
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub used_fraction: Option<f64>,
    pub remaining_fraction: Option<f64>,
    pub unit: Option<String>,
}

/// Native retry behavior currently configured for one owned omp profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryUsagePolicy {
    pub usage_aware_fallback: bool,
    pub usage_reserve_pct: u8,
    /// Native model fallback permits usage-aware routing beyond one model/provider.
    pub model_fallback_enabled: bool,
    pub same_provider_only_eligible: bool,
    pub constraints: Vec<String>,
}

/// Read `omp usage --json --no-extensions` for a profile already resolved by
/// the caller. Blocking: callers must run this outside the IPC main thread.
pub fn fetch(profile: Option<&str>) -> Result<QuotaSnapshot, String> {
    let args = usage_args(profile);
    let output = run_omp(&args, None)?;
    if !output.status.success() {
        return Err(format!("omp usage failed (exit {})", output.status));
    }
    parse_snapshot(&output.stdout)
}

/// Read the effective native quota-aware retry policy. This is a read-only
/// operation; all setting access is serialized with [`apply_policy`].
pub fn read_policy(
    profile: Option<&str>,
    folder: &std::path::Path,
) -> Result<RetryUsagePolicy, String> {
    let _guard = POLICY_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    read_policy_locked(profile, folder)
}

/// Apply the native usage-aware retry switch and its 10% reserve, preserving
/// unrelated settings and verifying both settings by reading them back.
/// Enabling is refused while native model fallback can broaden routing.
/// No policy is applied automatically; call only after explicit user action.
pub fn apply_policy(
    profile: Option<&str>,
    folder: &std::path::Path,
    enabled: bool,
) -> Result<RetryUsagePolicy, String> {
    let _guard = POLICY_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let before = read_policy_locked(profile, folder)?;
    if enabled && !before.same_provider_only_eligible {
        return Err(
            "cannot enable usage-aware fallback while retry.modelFallback is enabled".into(),
        );
    }
    if before.usage_reserve_pct != 10 {
        write_setting(profile, folder, RESERVE_KEY, &Value::from(10))?;
    }
    if before.usage_aware_fallback != enabled {
        write_setting(profile, folder, USAGE_AWARE_KEY, &Value::from(enabled))?;
    }
    let after = read_policy_locked(profile, folder)?;
    if after.usage_reserve_pct != 10 || after.usage_aware_fallback != enabled {
        return Err("omp did not retain the requested retry usage policy".into());
    }
    Ok(after)
}

fn read_policy_locked(
    profile: Option<&str>,
    folder: &std::path::Path,
) -> Result<RetryUsagePolicy, String> {
    let usage_aware_fallback = read_bool_setting(profile, folder, USAGE_AWARE_KEY)?;
    let reserve = read_number_setting(profile, folder, RESERVE_KEY)?;
    let usage_reserve_pct = u8::try_from(reserve)
        .ok()
        .filter(|pct| *pct <= 100)
        .ok_or_else(|| format!("invalid {RESERVE_KEY} value from omp"))?;
    let model_fallback_enabled = read_bool_setting(profile, folder, MODEL_FALLBACK_KEY)?;
    let same_provider_only_eligible = !model_fallback_enabled;
    let constraints = if same_provider_only_eligible {
        vec![
            "omp owns account selection and retry behavior".into(),
            "no model fallback is configured".into(),
        ]
    } else {
        vec![
            "native usage-aware fallback may switch models or providers".into(),
            "disable retry.modelFallback before enabling".into(),
        ]
    };
    Ok(RetryUsagePolicy {
        usage_aware_fallback,
        usage_reserve_pct,
        model_fallback_enabled,
        same_provider_only_eligible,
        constraints,
    })
}

fn read_bool_setting(
    profile: Option<&str>,
    folder: &std::path::Path,
    key: &str,
) -> Result<bool, String> {
    let value = read_setting(profile, folder, key)?;
    value
        .as_bool()
        .ok_or_else(|| format!("invalid {key} value from omp"))
}

fn read_number_setting(
    profile: Option<&str>,
    folder: &std::path::Path,
    key: &str,
) -> Result<u64, String> {
    let value = read_setting(profile, folder, key)?;
    value
        .as_u64()
        .ok_or_else(|| format!("invalid {key} value from omp"))
}

fn read_setting(
    profile: Option<&str>,
    folder: &std::path::Path,
    key: &str,
) -> Result<Value, String> {
    let mut args = config_prefix(profile);
    args.extend(["get".into(), key.into(), "--json".into()]);
    let output = run_omp(&args, Some(folder))?;
    if !output.status.success() {
        return Err(format!("omp config get {key} failed"));
    }
    let document: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| format!("invalid omp config get {key} response"))?;
    document
        .get("value")
        .cloned()
        .ok_or_else(|| format!("missing {key} value from omp"))
}

fn write_setting(
    profile: Option<&str>,
    folder: &std::path::Path,
    key: &str,
    value: &Value,
) -> Result<(), String> {
    let mut args = config_prefix(profile);
    args.extend(["set".into(), key.into()]);
    args.push(serde_json::to_string(value).map_err(|_| format!("could not encode {key}"))?);
    let output = run_omp(&args, Some(folder))?;
    if !output.status.success() {
        return Err(format!("omp config set {key} failed"));
    }
    Ok(())
}

fn config_prefix(profile: Option<&str>) -> Vec<String> {
    let mut args = Vec::with_capacity(2);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.push("config".into());
    args
}

fn usage_args(profile: Option<&str>) -> Vec<String> {
    let mut args = Vec::with_capacity(4);
    args.extend(crate::agent::spawn::profile_flag(profile));
    args.extend(["usage", "--json", "--no-extensions"].map(String::from));
    args
}

fn run_omp(
    args: &[String],
    folder: Option<&std::path::Path>,
) -> Result<std::process::Output, String> {
    let mut command = crate::agent::spawn::omp_command()?;
    if let Some(folder) = folder {
        command.current_dir(folder);
    }
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessSupervisor::prepare(&mut command);
    let mut child = crate::spawn_gate::spawn(&mut command)
        .map_err(|error| format!("could not start omp: {error}"))?;
    let supervisor = ProcessSupervisor::attach(&child);
    let finished = collect(
        &mut child,
        &supervisor,
        OUTPUT_LIMIT,
        STDERR_LIMIT,
        Instant::now() + TIMEOUT,
        |_| Ok(()),
    )
    .map_err(|error| match error {
        WaitError::Overflow => "omp output exceeded its size limit".to_string(),
        WaitError::TimedOut => "omp command timed out".to_string(),
        WaitError::Failed(_) => "omp command failed".to_string(),
    })?;
    Ok(std::process::Output {
        status: finished.status,
        stdout: finished.stdout,
        stderr: finished.stderr,
    })
}

fn parse_snapshot(bytes: &[u8]) -> Result<QuotaSnapshot, String> {
    let root: Value =
        serde_json::from_slice(bytes).map_err(|_| "invalid omp usage JSON".to_string())?;
    let object = root
        .as_object()
        .ok_or_else(|| "invalid omp usage JSON".to_string())?;
    let generated_at = object.get("generatedAt").and_then(Value::as_u64);
    let reports = object
        .get("reports")
        .and_then(Value::as_array)
        .ok_or_else(|| "omp usage response has no reports".to_string())?
        .iter()
        .map(parse_report)
        .collect();
    let accounts_without_usage = object
        .get("accountsWithoutUsage")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(|row| parse_account(row, None)).collect())
        .unwrap_or_default();
    let disabled_credentials = object
        .get("disabledCredentials")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(|row| parse_account(row, None)).collect())
        .unwrap_or_default();
    Ok(QuotaSnapshot {
        generated_at,
        reports,
        accounts_without_usage,
        disabled_credentials,
    })
}

fn parse_report(value: &Value) -> QuotaReport {
    let Some(object) = value.as_object() else {
        return QuotaReport {
            provider: None,
            fetched_at: None,
            account: None,
            limits: Vec::new(),
            error: Some("malformed quota report".into()),
        };
    };
    let provider = safe_text(object.get("provider"));
    let account = object
        .get("metadata")
        .and_then(Value::as_object)
        .map(|m| account_summary(m, provider.as_deref()));
    let limits = object
        .get("limits")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(parse_limit).collect())
        .unwrap_or_default();
    let fetched_at = object.get("fetchedAt").and_then(Value::as_u64);
    QuotaReport {
        provider,
        fetched_at,
        account,
        limits,
        error: None,
    }
}
fn account_summary(
    object: &serde_json::Map<String, Value>,
    provider: Option<&str>,
) -> AccountSummary {
    AccountSummary {
        provider: safe_text(object.get("provider")).or_else(|| provider.map(str::to_owned)),
        id: safe_identifier(object.get("id")).or_else(|| safe_identifier(object.get("accountId"))),
        organization: safe_text_first(
            object,
            &[
                "organization",
                "organizationName",
                "orgName",
                "orgId",
                "workspace",
            ],
        ),
        user: safe_text_first(object, &["user", "email"]),
    }
}
fn parse_account(value: &Value, provider: Option<&str>) -> AccountSummary {
    value
        .as_object()
        .map_or_else(AccountSummary::default, |object| {
            account_summary(object, provider)
        })
}

fn safe_identifier(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::String(text) if text.len() <= 512 => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn parse_limit(value: &Value) -> QuotaLimit {
    let Some(object) = value.as_object() else {
        return QuotaLimit {
            id: None,
            label: None,
            scope: None,
            window: None,
            amount: None,
            status: None,
        };
    };
    QuotaLimit {
        id: safe_text(object.get("id")),
        label: safe_text(object.get("label")),
        scope: object.get("scope").and_then(parse_scope),
        window: object.get("window").and_then(parse_window),
        amount: object.get("amount").and_then(parse_amount),
        status: safe_text(object.get("status")),
    }
}

fn parse_scope(value: &Value) -> Option<QuotaScope> {
    let object = value.as_object()?;
    Some(QuotaScope {
        provider: safe_text(object.get("provider")),
        account_id: safe_text(object.get("accountId")),
        organization_id: safe_text(object.get("orgId")),
        model_id: safe_text(object.get("modelId")),
        tier: safe_text(object.get("tier")),
        window_id: safe_text(object.get("windowId")),
        shared: object.get("shared").and_then(Value::as_bool),
    })
}

fn parse_window(value: &Value) -> Option<QuotaWindow> {
    let object = value.as_object()?;
    Some(QuotaWindow {
        id: safe_text(object.get("id")),
        label: safe_text(object.get("label")),
        duration_ms: object.get("durationMs").and_then(Value::as_u64),
        resets_at: object.get("resetsAt").and_then(Value::as_u64),
    })
}

fn parse_amount(value: &Value) -> Option<QuotaAmount> {
    let object = value.as_object()?;
    let number = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    let unit = safe_text(object.get("unit"));
    Some(QuotaAmount {
        used: number("used"),
        limit: number("limit"),
        remaining: number("remaining"),
        used_fraction: number("usedFraction"),
        remaining_fraction: number("remainingFraction"),
        unit,
    })
}
fn safe_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|text| text.len() <= 512)
        .map(str::to_owned)
}

fn safe_text_first(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| safe_text(object.get(*key)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_args_put_profile_before_subcommand_and_disable_extensions() {
        assert_eq!(
            usage_args(Some("work")),
            ["--profile=work", "usage", "--json", "--no-extensions"]
        );
        assert_eq!(usage_args(None), ["usage", "--json", "--no-extensions"]);
    }

    #[test]
    fn quota_parser_keeps_typed_usage_and_drops_metadata() {
        let snapshot = parse_snapshot(br#"{"generatedAt":1000,"reports":[{"provider":"acme","fetchedAt":900,"metadata":{"accountId":"42","orgName":"team","email":"a@b","token":"secret"},"limits":[{"id":"weekly","label":"Week","scope":{"provider":"acme","windowId":"weekly","accountId":"42"},"window":{"id":"weekly","label":"Week","resetsAt":2000},"amount":{"used":25,"limit":100,"remaining":75,"usedFraction":0.25,"remainingFraction":0.75,"unit":"requests"},"status":"ok","metadata":{"secret":"leak"}}]}],"accountsWithoutUsage":[],"disabledCredentials":[]}"#).unwrap();
        let encoded = serde_json::to_string(&snapshot).unwrap();
        assert!(!encoded.contains("secret"));
        assert_eq!(
            snapshot.reports[0].account.as_ref().unwrap().id.as_deref(),
            Some("42")
        );
        assert_eq!(snapshot.reports[0].fetched_at, Some(900));
        assert_eq!(
            snapshot.reports[0].limits[0]
                .amount
                .as_ref()
                .unwrap()
                .remaining,
            Some(75.0)
        );
        assert_eq!(
            snapshot.reports[0].limits[0]
                .window
                .as_ref()
                .unwrap()
                .resets_at,
            Some(2000)
        );
    }

    #[test]
    fn absent_amount_remains_unknown_and_malformed_root_fails() {
        let snapshot = parse_snapshot(
            br#"{"reports":[{"provider":"x","limits":[{"scope":{"provider":"x"}}]}]}"#,
        )
        .unwrap();
        assert_eq!(snapshot.reports[0].limits[0].amount, None);
        assert!(parse_snapshot(b"not json").is_err());
    }

    #[test]
    fn config_args_keep_profile_before_config_subcommand() {
        assert_eq!(config_prefix(Some("p")), ["--profile=p", "config"]);
    }

    #[test]
    fn malformed_quota_values_remain_unknown() {
        assert_eq!(parse_amount(&Value::Null), None);
        assert_eq!(
            parse_amount(&serde_json::json!({"used": "1"}))
                .unwrap()
                .used,
            None
        );
    }
}
