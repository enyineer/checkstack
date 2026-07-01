---
"@checkstack/frontend": minor
---

Load bundled and remote plugins exactly once per page load. The plugin load
ran inside App's mount effect, which React.StrictMode invokes twice in dev, so
`loadLocalPlugins()` fired twice and the registry logged a noisy
"⚠️ Plugin <id> already registered" for every bundled plugin on the second
pass. The load promise is now memoized at module scope: the actual
registration runs once while each effect invocation still awaits the same
promise, so the loading state resolves correctly and the duplicate-registration
warnings are gone.
