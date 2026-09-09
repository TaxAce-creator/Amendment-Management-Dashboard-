export { COOKIE_NAME } from "@shared/const";

export const startLogin = () => {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    };
    