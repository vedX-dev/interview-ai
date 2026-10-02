import { jsPDF } from "jspdf";

export interface FeedbackExportData {
  overallScore: number;
  summary: string;
  strengths: string[];
  areasForImprovement: string[];
  skillAssessments: Array<{
    skill: string;
    demonstrated: boolean;
    confidence: "high" | "medium" | "low";
    notes: string;
  }>;
  questionFeedback: Array<{
    question: string;
    focusArea: string;
    answerQuality: "excellent" | "good" | "fair" | "poor" | "no_answer";
    strengths: string[];
    gaps: string[];
    suggestedImprovement?: string;
  }>;
  recommendedFollowUp?: string;
  hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire";
  interviewDuration: number;
  integrityEvents?: Array<{
    type: string;
    timestamp: number;
    details?: string;
    durationMs?: number;
  }>;
}

export interface TranscriptChunkExport {
  id: string;
  speaker: "user" | "ai";
  content: string;
  createdAt?: string;
}

export function generateFeedbackPdf(
  feedback: FeedbackExportData,
  jobRole: string,
  interviewId: string,
  transcript: TranscriptChunkExport[] = []
) {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const maxY = pageHeight - 20;

  let y = margin;

  // Primary Color Palette
  const colors = {
    primary: [124, 58, 237] as [number, number, number], // Violet
    darkBg: [15, 23, 42] as [number, number, number], // Slate 900
    textDark: [30, 41, 59] as [number, number, number], // Slate 800
    textMuted: [100, 116, 139] as [number, number, number], // Slate 500
    emerald: [16, 185, 129] as [number, number, number],
    amber: [245, 158, 11] as [number, number, number],
    rose: [244, 63, 94] as [number, number, number],
    cardBg: [248, 250, 252] as [number, number, number],
    border: [226, 232, 240] as [number, number, number],
  };

  function checkNewPage(neededHeight: number) {
    if (y + neededHeight > maxY) {
      doc.addPage();
      y = margin + 10;
      drawRunningHeader();
    }
  }

  function drawRunningHeader() {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...colors.textMuted);
    doc.text("INTERVIA EVALUATION REPORT", margin, 10);
    doc.text(`ID: ${interviewId.slice(0, 8)}`, pageWidth - margin, 10, { align: "right" });
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, 12, pageWidth - margin, 12);
  }

  // --- 1. COVER / HEADER SECTION ---
  doc.setFillColor(...colors.darkBg);
  doc.rect(0, 0, pageWidth, 42, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Intervia Evaluation Report", margin, 18);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(203, 213, 225); // Slate 300
  doc.text(`Job Role: ${jobRole.toUpperCase()}`, margin, 26);

  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated: ${formattedDate} | Session ID: ${interviewId}`, margin, 33);

  // Hiring Recommendation Badge in Header
  let recLabel = "CONSIDER";
  let recBg: [number, number, number] = colors.amber;
  switch (feedback.hiringRecommendation) {
    case "strong_hire":
      recLabel = "STRONG HIRE";
      recBg = colors.emerald;
      break;
    case "hire":
      recLabel = "HIRE";
      recBg = colors.emerald;
      break;
    case "do_not_hire":
      recLabel = "DO NOT HIRE";
      recBg = colors.rose;
      break;
  }

  doc.setFillColor(...recBg);
  doc.roundedRect(pageWidth - margin - 40, 14, 40, 10, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(recLabel, pageWidth - margin - 20, 20.5, { align: "center" });

  y = 52;

  // --- 2. OVERVIEW & EXECUTIVE SUMMARY CARD ---
  checkNewPage(45);

  // Score Box
  const scoreBoxWidth = 45;
  const scoreBoxHeight = 35;

  let scoreColor: [number, number, number] = colors.emerald;
  if (feedback.overallScore < 70) scoreColor = colors.amber;
  if (feedback.overallScore < 50) scoreColor = colors.rose;

  doc.setFillColor(...colors.cardBg);
  doc.setDrawColor(...colors.border);
  doc.roundedRect(margin, y, scoreBoxWidth, scoreBoxHeight, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...scoreColor);
  doc.text(`${feedback.overallScore}`, margin + scoreBoxWidth / 2, y + 18, { align: "center" });

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...colors.textMuted);
  doc.text("OVERALL SCORE / 100", margin + scoreBoxWidth / 2, y + 27, { align: "center" });

  // Summary Text Container
  const summaryX = margin + scoreBoxWidth + 6;
  const summaryWidth = contentWidth - scoreBoxWidth - 6;

  doc.setFillColor(...colors.cardBg);
  doc.roundedRect(summaryX, y, summaryWidth, scoreBoxHeight, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...colors.textDark);
  doc.text("Executive Summary", summaryX + 5, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...colors.textDark);
  const splitSummary = doc.splitTextToSize(feedback.summary || "No summary provided.", summaryWidth - 10);
  doc.text(splitSummary, summaryX + 5, y + 14);

  y += scoreBoxHeight + 10;

  // --- 3. DEMONSTRATED STRENGTHS & AREAS FOR IMPROVEMENT ---
  checkNewPage(50);

  const colWidth = (contentWidth - 6) / 2;

  // Strengths Box
  doc.setFillColor(240, 253, 244); // Light Green Tint
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(margin, y, colWidth, 48, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(22, 101, 52); // Dark Green
  doc.text("Key Demonstrated Strengths", margin + 5, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  let strY = y + 14;
  (feedback.strengths || []).slice(0, 4).forEach((str) => {
    const lines = doc.splitTextToSize(`• ${str}`, colWidth - 10);
    doc.text(lines, margin + 5, strY);
    strY += lines.length * 4.2;
  });

  // Areas for Improvement Box
  const col2X = margin + colWidth + 6;
  doc.setFillColor(254, 243, 199); // Light Amber Tint
  doc.setDrawColor(253, 230, 138);
  doc.roundedRect(col2X, y, colWidth, 48, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(146, 64, 14); // Dark Amber
  doc.text("Areas for Growth & Gaps", col2X + 5, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  let gapY = y + 14;
  (feedback.areasForImprovement || []).slice(0, 4).forEach((gap) => {
    const lines = doc.splitTextToSize(`• ${gap}`, colWidth - 10);
    doc.text(lines, col2X + 5, gapY);
    gapY += lines.length * 4.2;
  });

  y += 56;

  // --- 4. SKILL & TOPIC PROFICIENCY BREAKDOWN ---
  if (feedback.skillAssessments && feedback.skillAssessments.length > 0) {
    checkNewPage(40);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...colors.textDark);
    doc.text("Skill & Topic Proficiency Breakdown", margin, y);
    y += 6;

    // Table Header
    doc.setFillColor(...colors.darkBg);
    doc.rect(margin, y, contentWidth, 7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text("Skill / Topic", margin + 4, y + 5);
    doc.text("Confidence", margin + 65, y + 5);
    doc.text("Evaluation Notes", margin + 95, y + 5);

    y += 7;

    feedback.skillAssessments.forEach((sa, i) => {
      const notesLines = doc.splitTextToSize(sa.notes || "-", contentWidth - 99);
      const rowHeight = Math.max(8, notesLines.length * 4 + 4);

      checkNewPage(rowHeight);

      doc.setFillColor(i % 2 === 0 ? 255 : 248, i % 2 === 0 ? 255 : 250, i % 2 === 0 ? 255 : 252);
      doc.setDrawColor(...colors.border);
      doc.rect(margin, y, contentWidth, rowHeight, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...colors.textDark);
      doc.text(sa.skill, margin + 4, y + 5);

      // Confidence badge text
      let confColor: [number, number, number] = colors.emerald;
      if (sa.confidence === "medium") confColor = colors.amber;
      if (sa.confidence === "low") confColor = colors.rose;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...confColor);
      doc.text(sa.confidence.toUpperCase(), margin + 65, y + 5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...colors.textDark);
      doc.text(notesLines, margin + 95, y + 4.5);

      y += rowHeight;
    });

    y += 10;
  }

  // --- 5. QUESTION-BY-QUESTION EVALUATION ---
  if (feedback.questionFeedback && feedback.questionFeedback.length > 0) {
    checkNewPage(20);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...colors.textDark);
    doc.text(`Question Diagnostic (${feedback.questionFeedback.length} Evaluated Questions)`, margin, y);
    y += 6;

    feedback.questionFeedback.forEach((q, idx) => {
      const qLines = doc.splitTextToSize(`Q${idx + 1}: ${q.question}`, contentWidth - 10);
      const strText = (q.strengths || []).join("; ");
      const gapText = (q.gaps || []).join("; ");
      const sugText = q.suggestedImprovement || "";

      const strLines = strText ? doc.splitTextToSize(`Strengths: ${strText}`, contentWidth - 12) : [];
      const gapLines = gapText ? doc.splitTextToSize(`Gaps: ${gapText}`, contentWidth - 12) : [];
      const sugLines = sugText ? doc.splitTextToSize(`Growth Recommendation: ${sugText}`, contentWidth - 12) : [];

      const cardHeight = 14 + qLines.length * 4.2 + (strLines.length ? strLines.length * 3.8 + 2 : 0) + (gapLines.length ? gapLines.length * 3.8 + 2 : 0) + (sugLines.length ? sugLines.length * 3.8 + 2 : 0);

      checkNewPage(cardHeight + 4);

      doc.setFillColor(...colors.cardBg);
      doc.setDrawColor(...colors.border);
      doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, "FD");

      // Header line inside card
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...colors.primary);
      doc.text((q.focusArea || `Topic ${idx + 1}`).toUpperCase(), margin + 4, y + 5);

      // Quality badge
      let qColor: [number, number, number] = colors.emerald;
      if (q.answerQuality === "good") qColor = colors.emerald;
      if (q.answerQuality === "fair") qColor = colors.amber;
      if (q.answerQuality === "poor" || q.answerQuality === "no_answer") qColor = colors.rose;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...qColor);
      doc.text(q.answerQuality.toUpperCase().replace("_", " "), pageWidth - margin - 4, y + 5, { align: "right" });

      // Question text
      let internalY = y + 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...colors.textDark);
      doc.text(qLines, margin + 4, internalY);
      internalY += qLines.length * 4.2 + 2;

      // Strengths
      if (strLines.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(22, 101, 52);
        doc.text(strLines, margin + 5, internalY);
        internalY += strLines.length * 3.8 + 2;
      }

      // Gaps
      if (gapLines.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(180, 83, 9);
        doc.text(gapLines, margin + 5, internalY);
        internalY += gapLines.length * 3.8 + 2;
      }

      // Suggested Improvement
      if (sugLines.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(...colors.primary);
        doc.text(sugLines, margin + 5, internalY);
      }

      y += cardHeight + 4;
    });

    y += 6;
  }

  // --- 6. INTEGRITY & PROCTORING SIGNALS ---
  checkNewPage(25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...colors.textDark);
  doc.text("Integrity & Proctoring Audit Signals", margin, y);
  y += 6;

  if (feedback.integrityEvents && feedback.integrityEvents.length > 0) {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
    doc.roundedRect(margin, y, contentWidth, 16, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...colors.rose);
    doc.text(`${feedback.integrityEvents.length} advisory proctoring event(s) logged during session.`, margin + 5, y + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...colors.textMuted);
    const eventTypes = feedback.integrityEvents.map((e) => e.type.replace("_", " ")).join(", ");
    doc.text(`Logged Signals: ${eventTypes}`, margin + 5, y + 11);
    y += 22;
  } else {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(margin, y, contentWidth, 12, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(22, 101, 52);
    doc.text("Clean Session: No proctoring anomalies or gaze violations were recorded.", margin + 5, y + 7.5);
    y += 18;
  }



  // --- 8. PAGE FOOTERS ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...colors.textMuted);
    doc.text("Intervia Autonomous Evaluation Platform • Strictly Confidential", margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: "right" });
  }

  // Save the PDF
  const safeJobRole = jobRole.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  doc.save(`Intervia-Report-${safeJobRole}-${interviewId.slice(0, 8)}.pdf`);
}
