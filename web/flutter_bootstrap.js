{{flutter_js}}
{{flutter_build_config}}
// Plan 4 (Task 3): the stock loader call plus failure reporting. When the
// engine or the loader fails, index.html's start screen shows its failure state
// (retry button, contact text) instead of leaving a blank page. The service
// worker settings are the stock ones (Flutter's worker is a self-unregistering
// stub; keeping the call keeps the clean-up of any old registration).
_flutter.loader.load({
  serviceWorkerSettings: {
    serviceWorkerVersion: {{flutter_service_worker_version}},
  },
  onEntrypointLoaded: async function (engineInitializer) {
    try {
      const appRunner = await engineInitializer.initializeEngine();
      await appRunner.runApp();
    } catch (e) {
      if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('engine');
      throw e;
    }
  },
}).catch(function (e) {
  if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('loader');
  console.error(e);
});
