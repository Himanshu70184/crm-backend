const BASE = 'http://127.0.0.1:5000/api';

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: 'superadmin@crm.com', password: 'Super@123' }),
  });
  const loginData = await login.json();
  if (!loginData.success) {
    console.log('LOGIN FAILED:', JSON.stringify(loginData));
    return;
  }
  const token = loginData.token;
  console.log('LOGIN OK, role =', loginData.user.role, 'avatar =', JSON.stringify(loginData.user.avatar));

  const me = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await me.json();
  console.log('ME avatar =', JSON.stringify(meData.user.avatar));

  const upd = await fetch(`${BASE}/auth/updateprofile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Super Admin', phone: '9999999999', department: 'Management' }),
  });
  const updData = await upd.json();
  console.log('UPDATE status', upd.status, '| success =', updData.success);
  if (updData.success) {
    console.log('UPDATE returned avatar =', JSON.stringify(updData.user.avatar));
    console.log('UPDATE returned name =', updData.user.name);
  } else {
    console.log('UPDATE error msg =', updData.message);
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
