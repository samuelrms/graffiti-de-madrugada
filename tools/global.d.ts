// Browser-side globals used inside page.evaluate() callbacks (tools/ and test/e2e).
export {};
declare global {
  interface Window {
    DBG: any;
    corr: string[];
  }
}
