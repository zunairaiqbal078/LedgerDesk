import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import { getPath } from "pdf-parse/worker";

// pdf.js in Node loads the worker via dynamic import; Next bundles pdf.mjs without
// pdf.worker.mjs beside it, so point at the package worker on disk.
PDFParse.setWorker(pathToFileURL(getPath()).href);

export { PDFParse };
