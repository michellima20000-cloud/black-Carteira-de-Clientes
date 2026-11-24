import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'

export default function SignupPage() {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const resp = await fetch('https://black-carteira-de-clientes.onrender.com/api/clientes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nome, email }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.message || 'Erro ao cadastrar')
      setSucesso('Conta criada com sucesso! Agora faça login.')
      // Limpar formulário após 2 segundos
      setNome('')
      setEmail('')
      setTimeout(() => navigate('/entrar'), 2000)
    } catch (err: any) {
      setErro(err.message || 'Erro ao cadastrar. Tente novamente.')
    }
  }

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <div className="max-w-md w-full space-y-4">
        <h2 className="text-2xl font-bold text-center">Criar Conta</h2>

        {erro && (
          <div className="bg-red-100 text-red-800 p-3 rounded">
            {erro}
          </div>
        )}

        {sucesso && (
          <div className="bg-green-100 text-green-800 p-3 rounded">
            {sucesso}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Nome completo</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value as string)}
              type="text"
              required
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">E-mail</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value as string)}
              type="email"
              required
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-primary text-white py-2 rounded hover:bg-primary-dark transition-colors"
          >
            Criar Conta
          </button>
        </form>

        <div className="text-center mt-4">
          <Link to="/entrar" className="text-blue-600 hover:text-blue-900">
            Já tem conta? Faça login
          </Link>
        </div>
      </div>
    </div>
  )
}