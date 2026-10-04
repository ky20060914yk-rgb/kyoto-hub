{{flutter_js}}
{{flutter_build_config}}
// Plan 4 (Tasks 2 and 3): the stock loader call plus
//  - failure reporting: when the engine or the loader fails, index.html's start
//    screen shows its failure state instead of a blank page;
//  - C-2, no stale code after a deploy: every build gets a new id (Flutter puts
//    a fresh random number into the service-worker token on each build).
//    main.dart.js is loaded as main.dart.js?v=<id>, and when the id differs
//    from the one this browser last started, the Flutter asset files (manifests
//    and the tree-shaken icon fonts) are re-downloaded once with
//    cache: 'reload'. Both escape copies that older deploys cached as
//    "immutable" for a year, which no header change can reach.
// The service-worker settings are the stock ones (Flutter's worker is a
// self-unregistering stub; keeping the call keeps the clean-up of an old one).
var kyotoHubBuild = {{flutter_service_worker_version}};
(function () {
  var build = String(kyotoHubBuild);
  _flutter.buildConfig.builds.forEach(function (b) {
    if (b.mainJsPath) b.mainJsPath += '?v=' + encodeURIComponent(build);
  });
  var KEY = 'kyotohub.build';
  var seen = null;
  try { seen = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: refresh every time */ }
  var refreshed = Promise.resolve();
  if (seen !== build) {
    var reload = function (path) { return fetch(path, { cache: 'reload' }); };
    refreshed = Promise.all([reload('assets/AssetManifest.bin.json'), reload('assets/AssetManifest.bin'), reload('assets/FontManifest.json')])
      .then(function (r) { return r[2].ok ? r[2].json() : []; })
      .then(function (families) {
        var files = [];
        (families || []).forEach(function (f) { (f.fonts || []).forEach(function (x) { if (x.asset) files.push(reload('assets/' + x.asset)); }); });
        return Promise.all(files);
      })
      .then(function () { try { window.localStorage.setItem(KEY, build); } catch (e) {} })
      .catch(function () { /* best effort: the engine still loads the files itself */ });
  }
  _flutter.loader.load({
    serviceWorkerSettings: {
      serviceWorkerVersion: kyotoHubBuild,
    },
    onEntrypointLoaded: async function (engineInitializer) {
      try {
        await refreshed;
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
})();
