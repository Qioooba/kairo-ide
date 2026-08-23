'use strict';
// P0 Browser startup polyfill: injected into lib/backend/main.js at build time
// Fixes Node 22 + Theia 1.73.1 where backend bundle includes frontend application-shell
// code requiring document/DragEvent/window.location. Direct prepend required because
// `theia start` spawns child without inheriting NODE_OPTIONS --require.
if (typeof document === 'undefined') {
  try {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true });
    try { global.window = dom.window; } catch (e) { try { Object.defineProperty(global, 'window', { value: dom.window, writable: true, configurable: true }); } catch {} }
    try { global.document = dom.window.document; } catch (e) { try { Object.defineProperty(global, 'document', { value: dom.window.document, writable: true, configurable: true }); } catch {} }
    try { global.navigator = dom.window.navigator; } catch (e) { try { Object.defineProperty(global, 'navigator', { value: dom.window.navigator, writable: true, configurable: true }); } catch {} }
    try { global.HTMLElement = dom.window.HTMLElement; } catch {}
    try { global.Node = dom.window.Node; } catch {}
    try { global.Element = dom.window.Element; } catch {}
    try { global.Event = dom.window.Event; } catch {}
    try { global.CustomEvent = dom.window.CustomEvent; } catch {}
    try { global.DragEvent = dom.window.DragEvent || class DragEvent extends dom.window.Event { constructor(t, o) { super(t, o); this.dataTransfer = o?.dataTransfer || null; } }; } catch {}
    try { global.DataTransfer = dom.window.DataTransfer || class DataTransfer { constructor() { this.data = new Map(); } setData(k,v){this.data.set(k,v);} getData(k){return this.data.get(k)||'';} }; } catch {}
    try { global.location = dom.window.location; } catch {}
    try { global.history = dom.window.history; } catch {}
    try { global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window); } catch {}
    try { global.requestAnimationFrame = dom.window.requestAnimationFrame ? dom.window.requestAnimationFrame.bind(dom.window) : (cb) => setTimeout(cb, 16); } catch {}
    try { global.cancelAnimationFrame = dom.window.cancelAnimationFrame ? dom.window.cancelAnimationFrame.bind(dom.window) : (id) => clearTimeout(id); } catch {}
    try { global.matchMedia = dom.window.matchMedia ? dom.window.matchMedia.bind(dom.window) : () => ({ matches:false, addListener:()=>{}, removeListener:()=>{}, addEventListener:()=>{}, removeEventListener:()=>{} }); } catch {}
    try { global.ResizeObserver = dom.window.ResizeObserver || class { observe(){} unobserve(){} disconnect(){} }; } catch {}
    try { global.IntersectionObserver = dom.window.IntersectionObserver || class { observe(){} unobserve(){} disconnect(){} }; } catch {}
    try { global.MutationObserver = dom.window.MutationObserver || class { observe(){} disconnect(){} takeRecords(){return[];} }; } catch {}
    try { global.self = global.window; } catch {}
    // Ensure window.* also mirrors globals for frontend checks like `typeof window`
    try { if (global.window) { global.window.DragEvent = global.window.DragEvent || global.DragEvent; global.window.DataTransfer = global.window.DataTransfer || global.DataTransfer; global.window.history = global.window.history || global.history; global.window.matchMedia = global.window.matchMedia || global.matchMedia; global.window.getComputedStyle = global.window.getComputedStyle || global.getComputedStyle; } } catch {}
    // Patch jsdom document/window with missing DOM APIs that Theia frontend expects (monaco, application-shell)
    try {
      if (global.document) {
        if (typeof global.document.queryCommandSupported !== 'function') global.document.queryCommandSupported = () => false;
        if (typeof global.document.queryCommandEnabled !== 'function') global.document.queryCommandEnabled = () => false;
        if (typeof global.document.execCommand !== 'function') global.document.execCommand = () => false;
        if (typeof global.document.hasFocus !== 'function') global.document.hasFocus = () => false;
        if (typeof global.document.createRange !== 'function') global.document.createRange = () => ({ setStart:()=>{}, setEnd:()=>{}, commonAncestorContainer: global.document.body, getBoundingClientRect:()=>({left:0,top:0,right:0,bottom:0}), getClientRects:()=>[], cloneContents:()=>({}), selectNodeContents:()=>{} });
        if (typeof global.document.elementFromPoint !== 'function') global.document.elementFromPoint = () => null;
        if (typeof global.document.elementsFromPoint !== 'function') global.document.elementsFromPoint = () => [];
      }
      if (global.window) {
        if (typeof global.window.getSelection !== 'function') global.window.getSelection = () => ({ removeAllRanges:()=>{}, addRange:()=>{}, rangeCount:0, getRangeAt:()=>null, toString:()=>'' });
        if (typeof global.getSelection !== 'function') global.getSelection = global.window.getSelection;
        if (typeof global.window.focus !== 'function') global.window.focus = () => {};
        if (typeof global.window.blur !== 'function') global.window.blur = () => {};
        if (typeof global.window.scrollTo !== 'function') global.window.scrollTo = () => {};
        if (typeof global.window.alert !== 'function') global.window.alert = () => {};
        if (typeof global.window.confirm !== 'function') global.window.confirm = () => false;
        if (typeof global.window.prompt !== 'function') global.window.prompt = () => null;
        if (!global.window.localStorage) global.window.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{}, key:()=>null, length:0 };
        try { if (!global.localStorage) global.localStorage = global.window.localStorage; } catch {}
        if (!global.window.sessionStorage) global.window.sessionStorage = global.window.localStorage;
        try { if (!global.sessionStorage) global.sessionStorage = global.window.sessionStorage; } catch {}
      }
    } catch {}
  } catch (e) {
    // Fallback minimal stub if jsdom not available
    global.document = {
      createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {}, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }),
      createTextNode: () => ({}),
      createRange: () => ({ setStart:()=>{}, setEnd:()=>{}, commonAncestorContainer: {}, getBoundingClientRect:()=>({left:0,top:0,right:0,bottom:0}), getClientRects:()=>[], cloneContents:()=>({}), selectNodeContents:()=>{} }),
      queryCommandSupported: () => false,
      queryCommandEnabled: () => false,
      execCommand: () => false,
      hasFocus: () => false,
      elementFromPoint: () => null,
      elementsFromPoint: () => [],
      getSelection: () => ({ removeAllRanges:()=>{}, addRange:()=>{}, rangeCount:0, getRangeAt:()=>null, toString:()=>'' }),
      body: { appendChild: () => {}, style: {}, classList: { add: () => {} } },
      head: { appendChild: () => {} },
      documentElement: { style: {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      adoptedStyleSheets: []
    };
    global.window = global;
    global.window.location = { href: 'http://localhost:18301', origin: 'http://localhost:18301', protocol: 'http:', host: 'localhost:18301', hostname: 'localhost', port: '18301', pathname: '/', search: '', hash: '', toString() { return this.href; } };
    global.location = global.window.location;
    global.window.history = { pushState: () => {}, replaceState: () => {}, length: 0 };
    global.window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    try { global.localStorage = global.window.localStorage; } catch {}
    global.window.sessionStorage = global.window.localStorage;
    try { global.navigator = { userAgent: 'node', platform: 'Win32', language: 'en' }; } catch { try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', platform: 'Win32', language: 'en' }, writable:true, configurable:true }); } catch {} }
    global.self = global;
    global.HTMLElement = class {};
    global.Node = class {};
    global.Element = class {};
    global.Event = global.Event || class Event { constructor(t, o) { this.type = t; } };
    global.CustomEvent = global.window.CustomEvent;
    global.DragEvent = class DragEvent { constructor(t, o) { this.type = t; this.dataTransfer = o?.dataTransfer || null; } };
    global.DataTransfer = class DataTransfer { constructor() { this.data = new Map(); } setData(k,v){this.data.set(k,v);} getData(k){return this.data.get(k)||'';} };
    global.window.DragEvent = global.DragEvent;
    global.window.DataTransfer = global.DataTransfer;
    global.window.Event = global.Event;
    global.location = global.window.location;
    global.history = global.window.history;
    global.document = global.document || global.window.document;
    global.window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
    global.matchMedia = global.window.matchMedia;
    global.window.getComputedStyle = () => ({ getPropertyValue: () => '', setProperty: () => {} });
    global.getComputedStyle = global.window.getComputedStyle;
    global.window.innerWidth = 1440;
    global.window.innerHeight = 900;
    global.window.devicePixelRatio = 1;
    global.window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    global.window.cancelAnimationFrame = (id) => clearTimeout(id);
    global.requestAnimationFrame = global.window.requestAnimationFrame;
    global.cancelAnimationFrame = global.window.cancelAnimationFrame;
    global.window.addEventListener = () => {};
    global.window.removeEventListener = () => {};
    global.window.dispatchEvent = () => true;
    global.window.getSelection = () => ({ removeAllRanges:()=>{}, addRange:()=>{}, rangeCount:0, getRangeAt:()=>null, toString:()=>'' });
    global.getSelection = global.window.getSelection;
    global.window.focus = () => {};
    global.window.blur = () => {};
    global.window.scrollTo = () => {};
    global.window.alert = () => {};
    global.window.confirm = () => false;
    global.window.prompt = () => null;
    global.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    global.ResizeObserver = global.window.ResizeObserver;
    global.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    global.IntersectionObserver = global.window.IntersectionObserver;
    global.window.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
    global.MutationObserver = global.window.MutationObserver;
  }
}
