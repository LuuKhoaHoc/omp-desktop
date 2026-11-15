function AccountQuotaSection() {
  const service = window.OMP_ACCOUNT_SERVICE;
  const [, redraw] = React.useReducer(n => n + 1, 0);
  const snapshot = service?.snapshot();
  const active = snapshot?.sessions?.find(tab => tab.id === snapshot.activeSessionId);
  const [profile, setProfile] = React.useState(active?.profile ?? snapshot?.noTabProfileId ?? "default");
  const [data, setData] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);
  const [accounts, setAccounts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const request = React.useRef(0);
  const provider = snapshot?.model?.provider;
  React.useEffect(() => service?.subscribe(redraw), [service]);
  const invoke = (command, extra = {}) => {
    if (!window.__TAURI__) return Promise.reject(new Error("Desktop connection unavailable"));
    return window.__TAURI__.core.invoke(command, { profile, sessionId: active?.id, ...extra });
  };
  const refresh = React.useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    const result = await Promise.allSettled([
      invoke("account_quota"),
      active?.profile === profile ? invoke("account_quota_policy") : Promise.resolve(null),
      active?.profile === profile && provider ? service?.accounts(active.id, provider) : Promise.resolve([]),
    ]);
    if (id !== request.current) return;
    setData(result[0].status === "fulfilled" ? result[0].value : null);
    setPolicy(result[1].status === "fulfilled" ? result[1].value : null);
    setAccounts(result[2].status === "fulfilled" ? result[2].value ?? [] : []);
    setError(result.filter(r => r.status === "rejected").map(r => String(r.reason?.message ?? r.reason)).join("\n"));
    setLoading(false);
  }, [profile, active?.id, active?.profile, provider, service]);
  React.useEffect(() => {
    setData(null); setPolicy(null); setAccounts([]);
    refresh();
    return () => { request.current++; };
  }, [refresh]);
  async function changePolicy(enabled) {
    setLoading(true); setError(""); setNotice("");
    try { setPolicy(await invoke("account_quota_policy_set", { enabled })); }
    catch (e) { setError(String(e.message ?? e)); }
    finally { setLoading(false); }
  }
  async function pin(account) {
    setLoading(true); setError("");
    try { setNotice(await service.pin(active.id, provider, account.credentialId)); await refresh(); }
    catch (e) { setError(String(e.message ?? e)); }
    finally { setLoading(false); }
  }
  const time = value => Number.isFinite(value) ? new Date(value).toLocaleString() : OMP_TR("Unavailable");
  const amount = limit => {
    const a = limit.amount;
    if (Number.isFinite(a?.remainingFraction)) return `${Math.round(a.remainingFraction * 100)}%`;
    if (Number.isFinite(a?.remaining)) return `${a.remaining.toLocaleString()} ${a.unit ?? ""}`;
    return OMP_TR("Unavailable");
  };
  return <>
    <section className="quota-section" aria-label={OMP_TR("Account quota")}>
      <div className="quota-heading"><h3>{OMP_TR("Account quota")}</h3>
        <button className="btn ghost" disabled={loading} onClick={refresh}>{OMP_TR("Refresh quota")}</button>
      </div>
      <label className="quota-profile">{OMP_TR("Profile")}
        <select value={profile} onChange={e => setProfile(e.target.value)} disabled={loading}>
          {(snapshot?.profiles ?? [{ id: "default", name: "default" }]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="quota-note">{OMP_TR("Quota comes from omp. Providers without quota support remain visible; unknown quota is never treated as unlimited.")}</p>
      {loading && <p role="status">{OMP_TR("Refreshing account quota…")}</p>}
      {error && <p className="quota-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && <p className="quota-note">{OMP_TR("Snapshot updated")}: {time(data.generatedAt)}</p>}
      {data?.reports?.map((report, i) => <article className="quota-account" key={`${report.provider}-${i}`}>
        <strong>{report.provider}</strong>
        <span className="quota-identity">{report.account?.user ?? report.account?.id ?? OMP_TR("Identity unavailable")}{report.account?.organization ? ` · ${report.account.organization}` : ""}</span>
        <span className="quota-note">{OMP_TR("Fetched")}: {time(report.fetchedAt)}</span>
        {report.error && <p role="alert">{report.error}</p>}
        {!report.limits.length && <p>{OMP_TR("No quota windows reported")}</p>}
        {report.limits.map((limit, j) => <div className="quota-window" key={j}>
          <span>{limit.label ?? limit.window?.label ?? limit.window?.id ?? limit.scope?.tier ?? OMP_TR("Quota window")}</span>
          <strong>{amount(limit)}</strong>
          <span className="quota-note">{OMP_TR("Resets")}: {time(limit.window?.resetsAt)}</span>
        </div>)}
      </article>)}
      {data?.accountsWithoutUsage?.map((account, i) => <div className="quota-account" key={`unknown-${i}`}><strong>{account.provider}</strong><span>{account.user ?? account.id ?? OMP_TR("Identity unavailable")}</span><span className="quota-note">{OMP_TR("Quota unavailable")}</span></div>)}
      {data?.disabledCredentials?.map((account, i) => <div className="quota-account" key={`disabled-${i}`}><strong>{account.provider}</strong><span>{account.user ?? account.id ?? OMP_TR("Identity unavailable")}</span><span className="quota-error">{OMP_TR("Credential disabled; sign in again")}</span></div>)}
      {data && !data.reports?.length && !data.accountsWithoutUsage?.length && !data.disabledCredentials?.length && <p>{OMP_TR("No accounts found in this profile")}</p>}
      <h4>{OMP_TR("Native quota routing")}</h4>
      <p className="quota-note">{OMP_TR("omp keeps account selection and retries. The reserve is 10%. This control never enables model or provider fallback.")}</p>
      {policy && <>
        <label className="quota-toggle"><input type="checkbox" checked={policy.usageAwareFallback} disabled={loading || (!policy.usageAwareFallback && !policy.sameProviderOnlyEligible)} onChange={e => changePolicy(e.target.checked)} />{OMP_TR("Enable native quota-aware routing")}</label>
        <p>{OMP_TR("Configured reserve")}: {policy.usageReservePct}%</p>
        {policy.constraints?.map((text, i) => <p className="quota-note" key={i}>{text}</p>)}
      </>}
      <h4>{OMP_TR("Choose account for this chat")}</h4>
      <p className="quota-note">{OMP_TR("Manual selection pins the account. Explicit pins override normal quota ranking; hard unavailability can still trigger native rotation.")}</p>
      {active?.profile !== profile && <p>{OMP_TR("Open a chat in this profile to select its account")}</p>}
      {accounts.filter(account => account.type === "oauth").map(account => <div className="quota-pin" key={account.credentialId}>
        <span>{account.label}<small>{account.detail}</small></span>
        <button className="btn ghost" disabled={loading || active?.runState !== "idle" || account.active} onClick={() => pin(account)}>{account.active ? OMP_TR("Active account") : OMP_TR("Use this account")}</button>
      </div>)}
    </section>
  </>;
}
window.AccountQuotaSection = AccountQuotaSection;
