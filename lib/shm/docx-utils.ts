/** Merge Word run splits so bracket placeholders become contiguous text. */
export function mergeDocxRuns(xml: string) {
  let prev = "";
  let next = xml.replace(/<(?:w:|ns\d+):tab\/>/g, "\t");
  const splitPattern = /<\/(?:w:|ns\d+):t><\/(?:w:|ns\d+):r><(?:w:|ns\d+):r[^>]*>(?:<(?:w:|ns\d+):rPr>(?:[^<]|<(?!\/?(?:w:|ns\d+):rPr>))*<\/(?:w:|ns\d+):rPr>)?<(?:w:|ns\d+):t[^>]*>/g;
  while (next !== prev) {
    prev = next;
    next = next.replace(splitPattern, "");
  }
  return next;
}
