import * as XLSX from 'xlsx';

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'READ_FILE') {
    try {
      const { file, fileIndex } = payload;
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        const columns = jsonData.length > 0 ? Object.keys(jsonData[0] as object) : [];

        self.postMessage({
          type: 'FILE_READ_SUCCESS',
          payload: {
            fileIndex,
            name: file.name,
            size: file.size,
            data: jsonData,
            columns
          }
        });
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      self.postMessage({ type: 'ERROR', payload: 'Failed to read file' });
    }
  }

  if (type === 'PROCESS_MERGE') {
    try {
      const { fileA, fileB, config, manualIds } = payload;
      const { joinPairs } = config;

      // Helper to find column name case-insensitively and handle common variations
      const getCol = (data: any[], target: string, variations: string[] = []) => {
        if (!data || data.length === 0) return target;
        const keys = Object.keys(data[0]);
        // 1. Exact case-insensitive match
        let found = keys.find(k => k.toUpperCase() === target.toUpperCase());
        if (found) return found;
        
        // 2. Variation match
        for (const v of variations) {
          found = keys.find(k => k.toUpperCase() === v.toUpperCase());
          if (found) return found;
        }

        // 3. Substring match as fallback
        found = keys.find(k => k.toUpperCase().includes(target.toUpperCase()));
        return found || target;
      };

      const colMaDdoA = getCol(fileA.data, 'MA_DDO', ['MA_DIEM_DO', 'MÃ ĐIỂM ĐO', 'MADD', 'Mã ĐĐ']);
      const colSoCtoA = getCol(fileA.data, 'SO_CTO', ['SERIAL_CTO', 'SỐ CÔNG TƠ', 'SO_GCS', 'Số CT']);
      const colBcsA = getCol(fileA.data, 'BCS', ['BỘ CHỈ SỐ', 'BO_CHI_SO', 'Mã BCS']);
      const colHsNhanA = getCol(fileA.data, 'HS_NHAN', ['HỆ SỐ NHÂN', 'HSN', 'Hệ số']);
      const colSluong1A = getCol(fileA.data, 'SLUONG_1', ['SẢN LƯỢNG', 'TOTAL_ENERGY', 'Sản lượng']);
      const colChisoCuA = getCol(fileA.data, 'CS_CU', ['CHỈ SỐ CŨ', 'CS_DAU', 'CS_CU', 'Chỉ số cũ', 'CHISO_CU']);

      const colMaDdoB = getCol(fileB.data, 'MPOINT_CMIS', ['MA_DDO', 'MA_DIEM_DO', 'MÃ ĐIỂM ĐO', 'MADD', 'Mã ĐĐ']);
      const colStatusB = getCol(fileB.data, 'STATUS', ['STATION', 'TRẠNG THÁI', 'TÌNH TRẠNG', 'Trạng thái']);
      const colSerialB = getCol(fileB.data, 'SERIAL_DOXA', ['SỐ CHẾ TẠO', 'SERIAL_CTO', 'SO_SERIAL', 'Số seri']);

      const detectedCols = {
        file1: { maDdo: colMaDdoA, soCto: colSoCtoA, bcs: colBcsA },
        file2: { maDdo: colMaDdoB, status: colStatusB, serial: colSerialB }
      };

      // Mapping for energy columns in File B
      const energyMapB = {
        'T1': getCol(fileB.data, 'ACTIVE_ENERGY_POS_T1'),
        'T2': getCol(fileB.data, 'ACTIVE_ENERGY_POS_T2'),
        'T3': getCol(fileB.data, 'ACTIVE_ENERGY_POS_T3'),
        'POS_TOTAL': getCol(fileB.data, 'REACTIVE_ENERGY_POS_TOTAL'),
        'NEG_T1': getCol(fileB.data, 'ACTIVE_ENERGY_NEG_T1'),
        'NEG_T2': getCol(fileB.data, 'ACTIVE_ENERGY_NEG_T2'),
        'NEG_T3': getCol(fileB.data, 'ACTIVE_ENERGY_NEG_T3'),
        'NEG_TOTAL': getCol(fileB.data, 'REACTIVE_ENERGY_NEG_TOTAL')
      };

      // Create lookup map for File B
      const lookupMapB = new Map();
      fileB.data.forEach((row: any) => {
        const key = String(row[colMaDdoB] || '').trim().toUpperCase();
        if (key) lookupMapB.set(key, row);
      });

      // Filter File A (Primary) based on manual IDs if provided
      let targetData = fileA.data;
      if (manualIds && manualIds.length > 0) {
        const idSet = new Set(manualIds.map((id: string) => id.trim().toUpperCase()));
        targetData = targetData.filter((row: any) => idSet.has(String(row[colMaDdoA] || '').trim().toUpperCase()));
      }

      const results = (manualIds && manualIds.length > 0) 
        ? manualIds.flatMap((id: string) => {
            const searchId = id.trim().toUpperCase();
            const rowB = lookupMapB.get(searchId);
            const rowsA = fileA.data.filter((r: any) => String(r[colMaDdoA] || '').trim().toUpperCase() === searchId);

            const rawStatus = rowB ? String(rowB[colStatusB] || '').trim().toUpperCase() : 'NOT_FOUND';
            const rawSerialB = rowB ? String(rowB[colSerialB] || '').trim().toUpperCase() : 'N/A';
            
            // If rows found in File 1, map each one
            if (rowsA.length > 0) {
              return rowsA.map((rowA: any) => {
                const soCtoA = String(rowA[colSoCtoA] || '').trim().toUpperCase();
                const bcs = String(rowA[colBcsA] || '').trim().toUpperCase();
                
                let matchReason = '';
                let ketQua = 0;
                
                if (rowB) {
                  if (rawSerialB === soCtoA) {
                    matchReason = `KHỚP (Serial: ${rawSerialB})`;
                    ketQua = 1;
                  } else {
                    matchReason = `SAI SERIAL (F1: ${soCtoA} | F2: ${rawSerialB})`;
                    ketQua = 0;
                  }
                } else {
                  matchReason = 'KHÔNG CÓ TRÊN ĐO XA';
                  ketQua = 0;
                }

                let mappedValue: any = '-';
                if (rowB) {
                  const bcsUpper = bcs.toUpperCase();
                  if (bcsUpper === 'KT' || bcsUpper === 'BT' || bcsUpper === '') mappedValue = rowB[energyMapB['T1']];
                  else if (bcsUpper === 'CD') mappedValue = rowB[energyMapB['T2']];
                  else if (bcsUpper === 'TD') mappedValue = rowB[energyMapB['T3']];
                  else if (bcsUpper === 'VC') mappedValue = rowB[energyMapB['POS_TOTAL']];
                  else if (bcsUpper === 'BN') mappedValue = rowB[energyMapB['NEG_T1']];
                  else if (bcsUpper === 'CN') mappedValue = rowB[energyMapB['NEG_T2']];
                  else if (bcsUpper === 'TN') mappedValue = rowB[energyMapB['NEG_T3']];
                  else if (bcsUpper === 'VN') mappedValue = rowB[energyMapB['NEG_TOTAL']];
                  else mappedValue = rowB[energyMapB['T1']];
                }

                return {
                  MA_DDO: searchId,
                  BCS: bcs,
                  SO_CTO: soCtoA,
                  HS_NHAN: rowA[colHsNhanA] || '-',
                  SLUONG_1: rowA[colSluong1A] || '-',
                  CHISO_CU: rowA[colChisoCuA] || '-',
                  CHISO_MOI: mappedValue,
                  STATUS_B: rawStatus,
                  SERIAL_B: rawSerialB,
                  MATCH_REASON: matchReason,
                  KET_QUA: ketQua
                };
              });
            } else {
              // Only in File 2 or not found at all
              return [{
                MA_DDO: searchId,
                BCS: '-',
                SO_CTO: 'N/A',
                HS_NHAN: '-',
                SLUONG_1: '-',
                CHISO_CU: '-',
                CHISO_MOI: rowB ? rowB[energyMapB['T1']] : '-',
                STATUS_B: rawStatus,
                SERIAL_B: rawSerialB,
                MATCH_REASON: rowB ? `CHỈ CÓ TRÊN ĐO XA (Status: ${rawStatus})` : 'KHÔNG CÓ TRÊN ĐO XA',
                KET_QUA: 0
              }];
            }
          })
        : targetData.map((rowA: any) => {
            const maDdo = String(rowA[colMaDdoA] || '').trim().toUpperCase();
            const soCtoA = String(rowA[colSoCtoA] || '').trim().toUpperCase();
            const rowB = lookupMapB.get(maDdo);

            const rawStatus = rowB ? String(rowB[colStatusB] || '').trim().toUpperCase() : '';
            const rawSerialB = rowB ? String(rowB[colSerialB] || '').trim().toUpperCase() : '';
            const serialMatch = rawSerialB === soCtoA;

            const isOnline = rawStatus === 'ONLINE' || rawStatus === 'ON';
            
            let matchReason = '';
            let ketQua = 0;
            if (rowB) {
              if (serialMatch) {
                matchReason = 'KHỚP';
                ketQua = 1;
              } else {
                matchReason = `SAI SERIAL (F1: ${soCtoA} | F2: ${rawSerialB})`;
              }
            } else {
              matchReason = 'KHÔNG CÓ TRÊN ĐO XA';
            }

            const bcs = String(rowA[colBcsA] || '').trim().toUpperCase();
            let mappedValue: any = '-';
            if (rowB) {
              if (bcs === 'KT' || bcs === 'BT' || bcs === '') mappedValue = rowB[energyMapB['T1']];
              else if (bcs === 'CD') mappedValue = rowB[energyMapB['T2']];
              else if (bcs === 'TD') mappedValue = rowB[energyMapB['T3']];
              else if (bcs === 'VC') mappedValue = rowB[energyMapB['POS_TOTAL']];
              else if (bcs === 'BN') mappedValue = rowB[energyMapB['NEG_T1']];
              else if (bcs === 'CN') mappedValue = rowB[energyMapB['NEG_T2']];
              else if (bcs === 'TN') mappedValue = rowB[energyMapB['NEG_T3']];
              else if (bcs === 'VN') mappedValue = rowB[energyMapB['NEG_TOTAL']];
              else mappedValue = rowB[energyMapB['T1']]; 
            }

            return {
              MA_DDO: rowA[colMaDdoA],
              BCS: rowA[colBcsA],
              SO_CTO: rowA[colSoCtoA],
              HS_NHAN: rowA[colHsNhanA],
              SLUONG_1: rowA[colSluong1A],
              CHISO_CU: rowA[colChisoCuA],
              CHISO_MOI: mappedValue,
              STATUS_B: rawStatus,
              SERIAL_B: rawSerialB,
              MATCH_REASON: matchReason,
              KET_QUA: ketQua,
            };
          });

      self.postMessage({
        type: 'PROCESS_SUCCESS',
        payload: {
          data: results,
          detectedCols,
          stats: {
            totalRows: fileA.data.length,
            mergedRows: results.filter(r => r.KET_QUA === 1).length
          }
        }
      });
    } catch (error) {
      self.postMessage({ type: 'ERROR', payload: 'Lỗi xử lý dữ liệu: ' + (error as Error).message });
    }
  }
};
