import { useState } from "react";

export default function Settings() {
  const [key, setKey] = useState("");

  const saveKey = () => {
    localStorage.setItem("gemini_api", key);
    alert("API key saved!");
  };

  return (
    <div className="p-6">
      <h1 className="text-xl">Enter Gemini API Key</h1>

      <input
        className="mt-4 p-2 text-black"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Paste API key"
      />

      <button
        className="mt-4 bg-yellow-500 px-4 py-2 rounded"
        onClick={saveKey}
      >
        Save
      </button>
    </div>
  );
}