// Theia's Monaco ESM graph imports plain CSS files. Node has no native CSS
// loader, so unit tests replace presentation-only imports with an empty module.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
