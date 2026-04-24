export interface ExcelFile {
  name: string;
  size: number;
  data: any[];
  columns: string[];
}

export interface ProcessingResult {
  data: any[];
  fileName: string;
  stats: {
    totalRows: number;
    mergedRows: number;
  };
}

export interface JoinPair {
  columnA: string;
  columnB: string;
}

export interface MergeConfig {
  fileAIndex: number;
  fileBIndex: number;
  joinPairs: JoinPair[];
}
