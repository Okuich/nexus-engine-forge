import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AnalysisResult } from '@/store/appStore';

interface QuoteParams {
  analysis: AnalysisResult;
  fileName: string;
  email: string;
  company: string;
  quantity: number;
  totalCost: number;
  volumeDiscount: number;
}

export function generateQuotePdf(params: QuoteParams): void {
  const { analysis, fileName, email, company, quantity, totalCost, volumeDiscount } = params;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = 20;

  // ── Brand bar ──────────────────────────────────────
  doc.setFillColor(20, 20, 25);
  doc.rect(0, 0, W, 38, 'F');
  doc.setFillColor(245, 158, 11); // accent
  doc.rect(0, 38, W, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(245, 158, 11);
  doc.text('FORGE', margin, 18);
  doc.setTextColor(220, 220, 230);
  doc.setFontSize(22);
  doc.text('CAD', margin + 33, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(160, 160, 170);
  doc.text('Manufacturing Quote', margin, 27);

  // Quote number & date
  const quoteNo = `FQ-${Date.now().toString(36).toUpperCase()}`;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.setFontSize(8);
  doc.text(`Quote #: ${quoteNo}`, W - margin, 14, { align: 'right' });
  doc.text(`Date: ${date}`, W - margin, 20, { align: 'right' });
  doc.text(`Valid for 30 days`, W - margin, 26, { align: 'right' });

  y = 48;

  // ── Client & part info ─────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('PREPARED FOR', margin, y);
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 50);
  doc.setFont('helvetica', 'bold');
  doc.text(company || 'Customer', margin, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(email || '—', margin, y + 12);

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('PART FILE', W / 2, y);
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 50);
  doc.setFont('helvetica', 'bold');
  doc.text(fileName, W / 2, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Quantity: ${quantity}`, W / 2, y + 12);

  y += 22;

  // ── Manufacturability score ────────────────────────
  doc.setDrawColor(230, 230, 235);
  doc.line(margin, y, W - margin, y);
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('MANUFACTURABILITY SCORE', margin, y);
  y += 6;

  const score = analysis.manufacturability;
  const barW = 80;
  const barH = 6;
  doc.setFillColor(235, 235, 240);
  doc.roundedRect(margin, y, barW, barH, 2, 2, 'F');
  const scoreColor = score >= 80 ? [34, 197, 94] : score >= 60 ? [245, 158, 11] : [239, 68, 68];
  doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.roundedRect(margin, y, barW * (score / 100), barH, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.text(`${score}/100`, margin + barW + 6, y + 5.5);

  const rating = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';
  doc.setFontSize(9);
  doc.text(rating, margin + barW + 28, y + 5.5);

  y += 16;

  // ── Cost Breakdown table ───────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('COST BREAKDOWN (PER UNIT)', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Item', 'Unit Cost', 'Qty', 'Line Total']],
    body: [
      ['Raw Material (Ti-6Al-4V)', `$${analysis.cost.material}`, `${quantity}`, `$${(analysis.cost.material * quantity).toLocaleString()}`],
      ['CNC Machining', `$${analysis.cost.machining}`, `${quantity}`, `$${(analysis.cost.machining * quantity).toLocaleString()}`],
      ['Tooling & Fixtures', `$${analysis.cost.tooling}`, `${quantity}`, `$${(analysis.cost.tooling * quantity).toLocaleString()}`],
    ],
    foot: volumeDiscount < 1
      ? [
          ['', '', 'Subtotal', `$${(analysis.cost.total * quantity).toLocaleString()}`],
          ['', '', `Volume Discount (${Math.round((1 - volumeDiscount) * 100)}%)`, `-$${((analysis.cost.total * quantity) - totalCost).toLocaleString()}`],
          ['', '', 'TOTAL', `$${totalCost.toLocaleString()}`],
        ]
      : [['', '', 'TOTAL', `$${totalCost.toLocaleString()}`]],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, textColor: [40, 40, 50] },
    headStyles: { fillColor: [240, 240, 245], textColor: [80, 80, 90], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [250, 250, 252], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 248, 252] },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Geometry summary ───────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('PART GEOMETRY', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Faces', 'Edges', 'Holes', 'Min Thickness', 'Volume']],
    body: [[
      `${analysis.geometry.faces}`,
      `${analysis.geometry.edges}`,
      `${analysis.geometry.holes}`,
      `${analysis.geometry.minThickness} mm`,
      `${analysis.geometry.volume} cm³`,
    ]],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, halign: 'center', textColor: [40, 40, 50] },
    headStyles: { fillColor: [240, 240, 245], textColor: [80, 80, 90], fontStyle: 'bold', fontSize: 8, halign: 'center' },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Risks & Recommendations ────────────────────────
  if (analysis.risks.length > 0) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 130);
    doc.text('RISKS & RECOMMENDATIONS', margin, y);
    y += 3;

    const sevLabel: Record<string, string> = { critical: '⬤ CRITICAL', high: '⬤ HIGH', medium: '⬤ MEDIUM', low: '⬤ LOW' };

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Severity', 'Issue', 'Detail']],
      body: analysis.risks.map((r) => [
        sevLabel[r.severity] || r.severity.toUpperCase(),
        r.title,
        r.description,
      ]),
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 3, textColor: [40, 40, 50] },
      headStyles: { fillColor: [240, 240, 245], textColor: [80, 80, 90], fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 36, fontStyle: 'bold' } },
      didParseCell(data) {
        if (data.column.index === 0 && data.section === 'body') {
          const txt = String(data.cell.raw);
          if (txt.includes('CRITICAL')) data.cell.styles.textColor = [220, 38, 38];
          else if (txt.includes('HIGH')) data.cell.styles.textColor = [234, 88, 12];
          else if (txt.includes('MEDIUM')) data.cell.styles.textColor = [202, 138, 4];
          else data.cell.styles.textColor = [34, 197, 94];
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // ── Timeline ───────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 130);
  doc.text('ESTIMATED TIMELINE', margin, y);
  y += 3;

  const leadDays = quantity >= 50 ? 28 : quantity >= 10 ? 18 : 10;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Phase', 'Duration', 'Notes']],
    body: [
      ['Order Confirmation', '1-2 days', 'Upon receipt of PO'],
      ['Material Procurement', `${Math.ceil(leadDays * 0.35)} days`, 'Ti-6Al-4V bar stock'],
      ['CNC Machining', `${Math.ceil(leadDays * 0.45)} days`, `${quantity} unit${quantity > 1 ? 's' : ''}, 5-axis milling`],
      ['QC & Inspection', `${Math.ceil(leadDays * 0.15)} days`, 'CMM + surface finish verification'],
      ['Shipping', '2-3 days', 'Tracked freight'],
    ],
    foot: [['', `Total: ~${leadDays} business days`, '']],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, textColor: [40, 40, 50] },
    headStyles: { fillColor: [240, 240, 245], textColor: [80, 80, 90], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [250, 250, 252], fontStyle: 'bold' },
  });

  y = (doc as any).lastAutoTable.finalY + 14;

  // ── Footer ─────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(230, 230, 235);
  doc.line(margin, pageH - 18, W - margin, pageH - 18);
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 170);
  doc.text('FORGECAD — AI-Powered Manufacturing Intelligence', margin, pageH - 12);
  doc.text(`Generated ${date}  •  ${quoteNo}`, W - margin, pageH - 12, { align: 'right' });
  doc.text('This quote is an estimate. Final pricing subject to design review and material availability.', margin, pageH - 7);

  // Save
  doc.save(`FORGECAD_Quote_${quoteNo}.pdf`);
}
