// Ambient declarations for this project's "module system": modules are plain
// classic scripts that share one global scope and hang their public surface off
// `window` (and off `self` inside the worker). tsc can't infer those cross-file
// globals, so they are declared here. Add an entry when a type-checked file reads or
// assigns a global that isn't listed. Shared state is typed `any` where its shape is
// owned by one feature module and is not worth restating here.

export {};

declare global {
  interface Window {
    /** ENV/OS/Workload/Compliance/MinGen rule engine (js/base/rule-engine.js). */
    RuleEngine: {
      apply: Function;
      getPreferredFamilies: Function;
      isBurstable: Function;
      isCurrentGen: Function;
      isARM: Function;
      meetsMinGeneration: Function;
    };

    // Provider data, set by the generated manifests and region files.
    AWS_DATA_READY?: boolean;
    AZURE_DATA_READY?: boolean;
    GCP_DATA_READY?: boolean;
    AWS_DATA_DATE?: string;
    AZURE_DATA_DATE?: string;
    GCP_DATA_DATE?: string;
    AWS_REGION_KEYS?: string[];
    AZURE_REGION_KEYS?: string[];
    GCP_REGION_KEYS?: string[];
    AWS_SPECS?: any;
    AZURE_SPECS?: any;
    GCP_SPECS?: any;

    // Engine classes and helpers, assigned at the end of their own files.
    BaseInstanceSelector: typeof BaseInstanceSelector;
    AWSInstanceSelector: typeof AWSInstanceSelector;
    AzureInstanceSelector: typeof AzureInstanceSelector;
    GCPInstanceSelector: typeof GCPInstanceSelector;
    InstanceSelectorFactory: any;
    getProviderStatistics: (provider: string) => any;
    getAvailableInstanceFamilies: (provider: string) => string[];
    _prewarmedSelectors: Record<string, any>;
    _regionScriptPromises: Record<string, Promise<void>>;
    _regionValidation: any;
    _workerWatchdogMs: number;

    // Run state (core/engine/generate.js): what the last run was for.
    _resultsProviders: string[];
    _resultsIngestToken: number;
    _relaxSuggestion: any;

    // Upload state (features/ingest.js).
    _ingestToken: number;
    _ingestFileSeq: number;
    _ingestLabel: string | null;
    _pendingIngest: any;
    _lastIngest: any;
    _uploadNote: string | null | undefined;
    _uploadFileNote: string | null | undefined;
    _uploadedSheets: any[] | null;
    _fileSignature: any;
    _savedMappingSignatures: any;
    _inputHygiene: any;
    _duplicatesAcknowledged: boolean;
    _memoryUnitAcknowledged: boolean;
    _syncSizeUnit: (id: string, el: HTMLSelectElement) => void;

    // Spreadsheet engines, loaded on demand.
    XLSX: any;
    _xlsxWriter: any;
    _xlsxParser: any;
    _xlsxLoadPromise: Promise<any> | null;

    // Manual entry (features/manual-entry.js).
    _manualEditIndex: number | null;
    _manualConfirmClear: boolean;
    _manualRegionDefaults: any;

    // Results preview (features/preview.js).
    _previewState: any;
    _previewFocusId: string | null;
    _previewFilterTimer: any;
    _previewCursorPos: any;
    _previewActiveColFilter: any;
    _previewColsMenuState: any;
    _sortPreview: (key: string) => void;
    _previewToggleNoMatch: (...args: any[]) => void;
    _previewToggleColumn: (...args: any[]) => void;
    _previewSetPageSize: (...args: any[]) => void;
    _previewGoToPage: (...args: any[]) => void;
    _previewFilterChanged: (...args: any[]) => void;
    _previewColumnFilterChanged: (...args: any[]) => void;
    _previewClearColumnFilters: (...args: any[]) => void;

    // Portfolio hand-off (features/portfolio.js).
    _portfolioPayload: any;
    _portfolioModel: any;

    toggleTheme: () => void;
  }

  // Assigned to window by the factory and called by bare name elsewhere.
  var getInstanceRecommendationWithSelector: (
    csvData: any[],
    selectedProviders: string[],
    options: any,
    hooks?: any,
  ) => Promise<any[]>;
  var validateProviderSupport: (providers: string[]) => boolean;

  // The recommendation worker is a classic worker; the DOM lib has no worker globals.
  function importScripts(...urls: string[]): void;

  /**
   * Form controls are looked up by id and the id decides the kind, which lib.dom cannot
   * know. A lookup that reads value or checked is typed as a control, so reading either
   * off an element that is not one is not caught here.
   */
  interface AppFormControl extends HTMLElement {
    value: string;
    checked: boolean;
    disabled: boolean;
    setSelectionRange(start: number | null, end: number | null): void;
  }
  interface Document {
    getElementById(elementId: string): AppFormControl | null;
  }
}
