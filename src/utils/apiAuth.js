// Utilitário para autenticação de administradores no frontend
// Armazena e envia apenas o token de sessão HMAC; NENHUMA senha fica no frontend.

export function obterToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function obterUsuario() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('auth_usuario');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function salvarSessao(token, usuario) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('auth_token', token);
  if (usuario) localStorage.setItem('auth_usuario', JSON.stringify(usuario));
}

export function limparSessao() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_usuario');
}

export async function authFetch(url, options = {}) {
  const token = obterToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const finalOptions = {
    ...options,
    headers
  };

  const response = await fetch(url, finalOptions);

  // Se a sessão expirou ou o token for inválido, notifica para redirecionar ao login
  if (response.status === 401) {
    limparSessao();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
  }

  return response;
}
