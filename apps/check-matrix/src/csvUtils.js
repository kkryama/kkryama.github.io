export const CSV_BOM = "\uFEFF";
export const CSV_LINE_BREAK = "\r\n";

export function normalizeCsvField(value) {
  if (value == null) {
    return "";
  }
  const stringValue = String(value);
  const normalized = stringValue.replace(/\r\n|\r|\n/g, CSV_LINE_BREAK);
  const escaped = normalized.replace(/"/g, "\"\"");
  const needsQuoting = /[",\r\n]/.test(normalized);
  return needsQuoting ? `"${escaped}"` : escaped;
}

export function createCsvStringFromTableData(tableData) {
  const headers = Array.isArray(tableData?.headers) ? tableData.headers : [];
  const rows = Array.isArray(tableData?.rows) ? tableData.rows : [];

  const csvRows = [];

  if (headers.length > 0) {
    const headerLabels = headers.map((header) => normalizeCsvField(header?.name ?? ""));
    csvRows.push(headerLabels.join(","));
  }

  rows.forEach((row) => {
    const values = Array.isArray(row?.values) ? row.values : [];
    let dataColumnIndex = 0;

    const cells = headers.map((header) => {
      const headerId = header?.id ?? "";
      if (headerId === "__tag__") {
        return normalizeCsvField(row?.tagLabel ?? "");
      }
      if (headerId === "__name__") {
        return normalizeCsvField(row?.name ?? "");
      }
      const value = values[dataColumnIndex] ?? "";
      dataColumnIndex += 1;
      return normalizeCsvField(value);
    });

    csvRows.push(cells.join(","));
  });

  const content = csvRows.join(CSV_LINE_BREAK);
  return `${CSV_BOM}${content}${CSV_LINE_BREAK}`;
}
