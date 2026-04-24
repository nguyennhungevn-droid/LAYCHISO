import { useState, useEffect, useRef } from 'react';
import { Database, Download, RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { FileUpload } from './components/FileUpload';
import { ExcelFile, MergeConfig, JoinPair } from './types';

export default function App() {
  const [fileA, setFileA] = useState<ExcelFile | null>(null);
  const [fileB, setFileB] = useState<ExcelFile | null>(null);
  const [rawFiles, setRawFiles] = useState<{ a: File | null; b: File | null }>({ a: null, b: null });
  const [loading, setLoading] = useState<{ a: boolean; b: boolean; processing: boolean }>({ a: false, b: false, processing: false });
  const [detectedCols, setDetectedCols] = useState<any>(null);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<any[] | null>(null);
  const [config, setConfig] = useState<MergeConfig>({
    fileAIndex: 0,
    fileBIndex: 1,
    joinPairs: [{ columnA: '', columnB: '' }],
  });

  const workerRef = useRef<Worker | null>(null);

  // IndexedDB Utilities
  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MPointVerifierCache', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const saveToDB = async (key: string, data: any) => {
    try {
      const db = await openDB();
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').put(data, key);
    } catch (e) {
      console.warn('DB Save Error:', e);
    }
  };

  const getFromDB = async (db: IDBDatabase, key: string): Promise<any> => {
    return new Promise((resolve) => {
      const transaction = db.transaction('files', 'readonly');
      const request = transaction.objectStore('files').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  };

  const deleteFromDB = async (key: string) => {
    try {
      const db = await openDB();
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').delete(key);
    } catch (e) {
      console.warn('DB Delete Error:', e);
    }
  };

  // Restore from Cache
  useEffect(() => {
    const restore = async () => {
      try {
        const db = await openDB();
        const cachedA = await getFromDB(db, 'fileA');
        const cachedB = await getFromDB(db, 'fileB');
        const cachedCols = await getFromDB(db, 'detectedCols');

        if (cachedA) setFileA(cachedA);
        if (cachedB) setFileB(cachedB);
        if (cachedCols) setDetectedCols(cachedCols);
      } catch (err) {
        console.warn('Restore failed:', err);
      }
    };
    restore();
  }, []);

  // Save to Cache on Change
  useEffect(() => {
    if (fileA) saveToDB('fileA', fileA);
  }, [fileA]);

  useEffect(() => {
    if (fileB) saveToDB('fileB', fileB);
  }, [fileB]);

  useEffect(() => {
    workerRef.current = new Worker(new URL('./workers/excelWorker.ts', import.meta.url), { type: 'module' });
    
    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'FILE_READ_SUCCESS') {
        const { fileIndex, name, size, data, columns } = payload;
        const excelFile = { name, size, data, columns };
        if (fileIndex === 0) {
          setFileA(excelFile);
          setLoading(prev => ({ ...prev, a: false }));
          const firstCol = columns[0] || '';
          setConfig(prev => ({ ...prev, joinPairs: [{ columnA: firstCol, columnB: prev.joinPairs[0].columnB }] }));
        } else {
          setFileB(excelFile);
          setLoading(prev => ({ ...prev, b: false }));
          const firstCol = columns[0] || '';
          setConfig(prev => ({ ...prev, joinPairs: [{ columnA: prev.joinPairs[0].columnA, columnB: firstCol }] }));
        }
      }
      if (type === 'PROCESS_SUCCESS') {
        setResult(payload.data);
        setDetectedCols(payload.detectedCols);
        saveToDB('detectedCols', payload.detectedCols);
        setMerging(false);
        setLoading(prev => ({ ...prev, processing: false }));
      }
      if (type === 'ERROR') {
        alert(payload);
        setLoading({ a: false, b: false, processing: false });
        setMerging(false);
      }
    };
    return () => workerRef.current?.terminate();
  }, []);

  const handleFileSelect = (file: File, index: number) => {
    setRawFiles(prev => ({ ...prev, [index === 0 ? 'a' : 'b']: file }));
    setLoading(prev => ({ ...prev, [index === 0 ? 'a' : 'b']: true }));
    workerRef.current?.postMessage({
      type: 'READ_FILE',
      payload: { file, fileIndex: index }
    });
  };

  const [manualIds, setManualIds] = useState('');

  const handleMerge = () => {
    if (!fileA || !fileB) return;
    
    // Parse manual IDs if provided
    const ids = manualIds
      .split(/[\n,]+/)
      .map(id => id.trim())
      .filter(id => id.length > 0);

    setMerging(true);
    setLoading(prev => ({ ...prev, processing: true }));
    workerRef.current?.postMessage({
      type: 'PROCESS_MERGE',
      payload: { fileA, fileB, config, manualIds: ids }
    });
  };

  const addJoinPair = () => {
    if (config.joinPairs.length >= 3) return;
    const newPair: JoinPair = {
      columnA: fileA?.columns[0] || '',
      columnB: fileB?.columns[0] || '',
    };
    setConfig(prev => ({ ...prev, joinPairs: [...prev.joinPairs, newPair] }));
  };

  const removeJoinPair = (index: number) => {
    if (config.joinPairs.length <= 1) return;
    const newPairs = [...config.joinPairs];
    newPairs.splice(index, 1);
    setConfig(prev => ({ ...prev, joinPairs: newPairs }));
  };

  const updateJoinPair = (index: number, side: 'columnA' | 'columnB', value: string) => {
    const newPairs = [...config.joinPairs];
    newPairs[index] = { ...newPairs[index], [side]: value };
    setConfig(prev => ({ ...prev, joinPairs: newPairs }));
  };

  return (
    <div className="min-h-screen py-10 px-8 max-w-[1280px] mx-auto flex flex-col font-sans">
      {/* Header */}
      <header className="flex justify-between items-end border-b-4 border-slate-900 pb-6 mb-12">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-slate-900">CÔNG CỤ KIỂM TRA ĐIỂM ĐO</h1>
          <p className="text-slate-500 font-medium mt-1 uppercase tracking-widest text-sm italic">XÁC MINH TRẠNG THÁI & CHỈ SỐ CÔNG TƠ</p>
        </div>
        <div className="text-right flex flex-col">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">VERIFIER-CORE</span>
          <span className="text-xl font-black font-mono text-indigo-600">V3.0.0</span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        
        {/* Sources - Left Column */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          <div className="geo-card-blue h-full">
            <h2 className="text-lg font-black uppercase mb-6 flex items-center gap-2">
              <span className="bg-slate-900 text-white px-2 py-0.5 text-sm">01</span> NGUỒN DỮ LIỆU
            </h2>
            
            <div className="space-y-4">
              <FileUpload 
                label="FILE 1 (DỮ LIỆU GỐC)"
                onFileSelect={(f) => handleFileSelect(f, 0)}
                onClear={() => { 
                  setFileA(null); 
                  setRawFiles(prev => ({ ...prev, a: null })); 
                  setResult(null); 
                  deleteFromDB('fileA');
                }}
                selectedFile={rawFiles.a}
                isLoading={loading.a}
              />
              <FileUpload 
                label="FILE 2 (DOWNLOAD TỪ ĐO XA)"
                onFileSelect={(f) => handleFileSelect(f, 1)}
                onClear={() => { 
                  setFileB(null); 
                  setRawFiles(prev => ({ ...prev, b: null })); 
                  setResult(null); 
                  deleteFromDB('fileB');
                }}
                selectedFile={rawFiles.b}
                isLoading={loading.b}
              />
            </div>
          </div>
        </section>

        {/* Action & Result - Right Column */}
        <section className="lg:col-span-8 flex flex-col gap-6">
          <div className="geo-card h-full flex flex-col">
            <h2 className="text-lg font-black uppercase mb-6 flex items-center gap-2">
              <span className="bg-slate-900 text-white px-2 py-0.5 text-sm">02</span> TRA CỨU & KIỂM TRA
            </h2>
            
            <div className="flex-1 space-y-6">
              <div className="p-6 bg-slate-50 border border-slate-200">
                <label className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 block">NHẬP MÃ ĐIỂM ĐO (MA_DDO)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualIds}
                    onChange={(e) => setManualIds(e.target.value)}
                    placeholder="Ví dụ: PB15040057656001"
                    className="input-geo flex-1 h-14 text-xl font-mono"
                  />
                  <button
                    disabled={!fileA || !fileB || merging || !manualIds}
                    onClick={handleMerge}
                    className="btn-geo h-14 px-10"
                  >
                    {merging ? <RefreshCw className="w-5 h-5 animate-spin" /> : "KIỂM TRA"}
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {result && result.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b-4 border-slate-900 pb-2">
                       <h2 className="text-2xl font-black italic tracking-tighter uppercase">KẾT QUẢ TRẢ VỀ [KETQUA]</h2>
                       <div className="bg-slate-900 text-white text-[10px] font-black px-2 py-1 uppercase tracking-widest leading-none">
                          FOUND: {result.length} BẢN GHI
                       </div>
                    </div>

                    <div className="overflow-x-auto border-2 border-slate-900">
                      <table className="w-full text-left border-collapse min-w-[900px]">
                        <thead className="bg-slate-900 text-white font-mono text-[10px] uppercase">
                          <tr>
                            <th className="p-3 border-r border-slate-700">ID (MA_DDO)</th>
                            <th className="p-3 border-r border-slate-700">SO_CTO</th>
                            <th className="p-3 border-r border-slate-700">BCS</th>
                            <th className="p-3 border-r border-slate-700">HS_NHAN</th>
                            <th className="p-3 border-r border-slate-700 text-right">SLUONG_1</th>
                            <th className="p-3 border-r border-slate-700 text-right">CHISO_CU</th>
                            <th className="p-3 border-r border-slate-700 text-right">CHISO_MOI</th>
                            <th className="p-3">GHI CHÚ</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-[11px]">
                          {result.map((row, idx) => (
                            <tr key={idx} className={`border-b border-slate-200 ${row.KET_QUA === 1 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                              <td className="p-3 border-r border-slate-200 font-bold text-slate-900 uppercase">{row.MA_DDO}</td>
                              <td className="p-3 border-r border-slate-200 uppercase">{row.SO_CTO}</td>
                              <td className="p-3 border-r border-slate-200 font-bold text-indigo-600 truncate max-w-[40px] text-center" title={row.BCS}>{row.BCS}</td>
                              <td className="p-3 border-r border-slate-200 text-right">{row.HS_NHAN}</td>
                              <td className="p-3 border-r border-slate-200 text-right">{row.SLUONG_1}</td>
                              <td className="p-3 border-r border-slate-200 text-right text-slate-500">{row.CHISO_CU}</td>
                              <td className="p-3 border-r border-slate-200 text-right font-black text-emerald-600 bg-emerald-100/30">{row.CHISO_MOI}</td>
                              <td className="p-3">
                                <div className={`font-black uppercase text-[9px] leading-tight ${row.KET_QUA === 1 ? 'text-emerald-700' : 'text-red-500'}`}>
                                  {row.MATCH_REASON}
                                </div>
                                <div className="text-[8px] text-slate-400 font-bold">{row.STATUS_B} / {row.SERIAL_B}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-auto pt-6 border-t border-slate-100 flex justify-between items-center bg-slate-900 text-white -mx-6 -mb-6 px-6 py-4">
              <div className="flex gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span>V3.0.0 STABLE</span>
                <span>MODE: SINGLE_ID_VERIFIER</span>
              </div>
              <button 
                onClick={() => { setManualIds(''); setResult(null); }}
                className="text-[10px] font-black uppercase bg-white text-slate-900 px-3 py-1 hover:bg-slate-200"
              >
                Làm mới
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="mt-12 flex justify-between items-center text-[10px] text-slate-400 font-mono tracking-widest uppercase border-t border-slate-200 pt-6">
        <div>CORE ENGINE: FAST-HASH V4</div>
        <div>ARCH: WEB-WORKER PROCESSING</div>
        <div>AUTO-SAVE: DISABLED</div>
      </footer>
    </div>
  );
}
