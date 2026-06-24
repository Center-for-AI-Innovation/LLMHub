'use client';

import { memo, useEffect, useState } from 'react';
import { DataGrid, renderTextEditor } from 'react-data-grid';
import { parse, unparse } from 'papaparse';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

import 'react-data-grid/lib/styles.css';

type SheetEditorProps = {
  content: string;
  saveContent: (content: string, isCurrentVersion: boolean) => void;
  status: string;
  isCurrentVersion: boolean;
  currentVersionIndex: number;
};

const MIN_ROWS = 50;
const MIN_COLS = 26;

const SPREADSHEET_COLUMNS = (() => {
  const rowNumberColumn = {
    key: 'rowNumber',
    name: '',
    frozen: true,
    width: 50,
    renderCell: ({ rowIdx }: { rowIdx: number }) => rowIdx + 1,
    cellClass: 'border-t border-r dark:bg-zinc-950 dark:text-zinc-50',
    headerCellClass: 'border-t border-r dark:bg-zinc-900 dark:text-zinc-50',
  };

  const dataColumns = Array.from({ length: MIN_COLS }, (_, i) => ({
    key: i.toString(),
    name: String.fromCharCode(65 + i),
    renderEditCell: renderTextEditor,
    width: 120,
    cellClass: cn(`border-t dark:bg-zinc-950 dark:text-zinc-50`, {
      'border-l': i !== 0,
    }),
    headerCellClass: cn(`border-t dark:bg-zinc-900 dark:text-zinc-50`, {
      'border-l': i !== 0,
    }),
  }));

  return [rowNumberColumn, ...dataColumns];
})();

function rowsFromCsvContent(content: string) {
  if (!content) {
    return Array.from({ length: MIN_ROWS }, (_, rowIndex) => {
      const rowData: Record<string, any> = {
        id: rowIndex,
        rowNumber: rowIndex + 1,
      };

      SPREADSHEET_COLUMNS.slice(1).forEach((col) => {
        rowData[col.key] = '';
      });

      return rowData;
    });
  }

  const result = parse<string[]>(content, { skipEmptyLines: true });

  const paddedData = result.data.map((row) => {
    const paddedRow = [...row];
    while (paddedRow.length < MIN_COLS) {
      paddedRow.push('');
    }
    return paddedRow;
  });

  while (paddedData.length < MIN_ROWS) {
    paddedData.push(Array(MIN_COLS).fill(''));
  }

  return paddedData.map((row, rowIndex) => {
    const rowData: Record<string, any> = {
      id: rowIndex,
      rowNumber: rowIndex + 1,
    };

    SPREADSHEET_COLUMNS.slice(1).forEach((col, colIndex) => {
      rowData[col.key] = row[colIndex] || '';
    });

    return rowData;
  });
}

const PureSpreadsheetEditor = ({
  content,
  saveContent,
  status,
  isCurrentVersion,
}: SheetEditorProps) => {
  const { theme } = useTheme();
  const [localRows, setLocalRows] = useState(() => rowsFromCsvContent(content));

  useEffect(() => {
    setLocalRows(rowsFromCsvContent(content));
  }, [content]);

  const generateCsv = (data: any[][]) => {
    return unparse(data);
  };

  const handleRowsChange = (newRows: any[]) => {
    setLocalRows(newRows);

    const updatedData = newRows.map((row) => {
      return SPREADSHEET_COLUMNS.slice(1).map((col) => row[col.key] || '');
    });

    const newCsvContent = generateCsv(updatedData);
    saveContent(newCsvContent, true);
  };

  return (
    <DataGrid
      className={theme === 'dark' ? 'rdg-dark' : 'rdg-light'}
      columns={SPREADSHEET_COLUMNS}
      rows={localRows}
      enableVirtualization
      onRowsChange={handleRowsChange}
      onCellClick={(args) => {
        if (args.column.key !== 'rowNumber') {
          args.selectCell(true);
        }
      }}
      style={{ height: '100%' }}
      defaultColumnOptions={{
        resizable: true,
        sortable: true,
      }}
    />
  );
};

function areEqual(prevProps: SheetEditorProps, nextProps: SheetEditorProps) {
  return (
    prevProps.currentVersionIndex === nextProps.currentVersionIndex &&
    prevProps.isCurrentVersion === nextProps.isCurrentVersion &&
    !(prevProps.status === 'streaming' && nextProps.status === 'streaming') &&
    prevProps.content === nextProps.content &&
    prevProps.saveContent === nextProps.saveContent
  );
}

export const SpreadsheetEditor = memo(PureSpreadsheetEditor, areEqual);
