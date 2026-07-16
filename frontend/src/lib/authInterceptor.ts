import axios from 'axios';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

/** Login endpoints legitimately return 401 for bad credentials — never redirect on those. */
function isLoginRequest(url: string | undefined): boolean {
  return typeof url === 'string' && url.includes('/api/auth/login');
}

/**
 * Global 401 handling: an expired or invalid JWT anywhere in the app clears the
 * session and returns the user to the login screen instead of failing silently.
 */
export function installAuthInterceptor(): void {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error?.response?.status;
      const url: string | undefined = error?.config?.url;
      if (status === 401 && !isLoginRequest(url)) {
        const hadToken = localStorage.getItem(TOKEN_KEY) !== null;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (hadToken && window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      }
      return Promise.reject(error);
    },
  );
}
