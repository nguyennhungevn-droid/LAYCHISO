import { useRef, useState, DragEvent } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FileUploadProps {
  label: string;
  onFileSelect: (file: File) => void;
  onClear: () => void;
  selectedFile: File | null;
  isLoading?: boolean;
}

export function FileUpload({ label, onFileSelect, onClear, selectedFile, isLoading }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: DragEvent) => {
    e.preventDefault();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
      onFileSelect(file);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-slate-50 border border-slate-200 p-4 transition-all">
        <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 block">
          {label}
        </label>
        
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed p-6 flex flex-col items-center justify-center transition-all min-h-[140px]
            ${isDragging ? 'border-slate-900 bg-slate-100' : 'border-slate-200 bg-white'}
          `}
        >
          <AnimatePresence mode="wait">
            {!selectedFile ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 text-center"
              >
                <Upload className="w-8 h-8 text-slate-300" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-tight">
                    <button
                      onClick={() => inputRef.current?.click()}
                      className="text-indigo-600 hover:underline"
                    >
                      Browse File
                    </button>
                    {' '}or Drop
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="selected"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-2 w-full"
              >
                <FileText className="w-8 h-8 text-indigo-600" />
                <div className="text-center w-full px-2">
                  <p className="text-sm font-black uppercase tracking-tighter truncate max-w-[180px] mx-auto">
                    {selectedFile.name}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={onClear}
                  className="absolute top-2 right-2 p-1 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
                {isLoading && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center">
                    <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-[10px] font-black uppercase">Indexing...</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
      />
    </div>
  );
}
