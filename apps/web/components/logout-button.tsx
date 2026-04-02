export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button className="button secondary" type="submit">
        Log out
      </button>
    </form>
  );
}
