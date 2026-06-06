// React 18 is CJS-only (no ESM build). `export *` cannot surface a CJS
// package's named exports through rolldown/esbuild, so we destructure the
// (stable, frozen) React 18 public API off the default object. `import { … }
// from "react"` in consumers then resolves to these named exports via the
// import map.
import React from "react";
export { default } from "react";
export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
