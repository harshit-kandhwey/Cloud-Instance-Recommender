// Globals the end-to-end specs read inside page.evaluate and waitForFunction callbacks.
// Their real definitions live in src/, which this program does not load.
export {};

declare global {
  interface Window {
    AWS_DATA_READY?: boolean;
    AZURE_DATA_READY?: boolean;
    GCP_DATA_READY?: boolean;
  }
  function getSelectedProcessorManufacturers(): string[];
  function getSelectedMainFamilies(): string[];
  function getSelectedAzureSeries(): string[];
  function getSelectedGCPFamilies(): string[];
}
