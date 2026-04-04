import { useState } from "react";
import { auth } from "../firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const signup = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("Account created");
      navigate("/");
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="min-h-screen flex justify-center items-center bg-black text-white">
      <div className="bg-white/10 p-6 rounded-xl">
        <h2 className="text-xl mb-4">Signup</h2>

        <input
          placeholder="Email"
          className="p-2 mb-3 text-black w-full"
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          placeholder="Password"
          type="password"
          className="p-2 mb-3 text-black w-full"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={signup}
          className="bg-blue-500 px-4 py-2 rounded w-full"
        >
          Signup
        </button>
      </div>
    </div>
  );
}