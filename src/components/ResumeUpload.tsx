"use client";

import { useState } from "react";

export default function ResumeUpload() {
  const [file, setFile] = useState<File | null>(null);

  const handleUpload = async () => {
    if (!file) return;

    // We use FormData for files
    const formData = new FormData();
    formData.append("file", file);

    // Call our Server Action (we will write this next)
    const response = await fetch("/api/parse-resume", {
      method: "POST",
      body: formData,
    });
    
    const data = await response.json();
    console.log("Parsed Data:", data);
  };

  return (
    <div className="p-8 border-2 border-dashed rounded-lg border-primary/20">
      <input 
        type="file" 
        accept=".pdf" 
        onChange={(e) => setFile(e.target.files?.[0] || null)} 
      />
      <button onClick={handleUpload} className="bg-primary text-white p-2 mt-4">
        Upload & Analyze
      </button>
    </div>
  );
}