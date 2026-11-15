function useAccountQuotaService() {
  React.useEffect(() => {
    if (!window.OMP_BRIDGE || !window.__TAURI__) return;
    const service = window.OMP_QUOTA_SERVICE.create(window.OMP_BRIDGE, window.__TAURI__);
    window.OMP_ACCOUNT_SERVICE = service;
    return () => {
      if (window.OMP_ACCOUNT_SERVICE === service) window.OMP_ACCOUNT_SERVICE = null;
      service.close();
    };
  }, []);
}
window.useAccountQuotaService = useAccountQuotaService;
