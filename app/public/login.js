const $ = s => document.querySelector(s);
let reg = location.hash === '#register', canReg = true;
function render() {
  $('#h').textContent = reg ? 'Регистрация' : 'Вход на портал';
  $('#s').textContent = reg ? 'Создайте аккаунт, чтобы открыть портал.' : 'Войдите, чтобы смотреть видео и фото, слушать музыку и читать новости.';
  $('#nameRow').hidden = !reg; $('#p2Row').hidden = !reg;
  $('#p').autocomplete = reg ? 'new-password' : 'current-password';
  $('#go').textContent = reg ? 'Зарегистрироваться' : 'Войти';
  $('#swText').textContent = reg ? 'Уже есть аккаунт?' : 'Нет аккаунта?';
  $('#sw').textContent = reg ? 'Войти' : 'Зарегистрироваться';
  $('#swRow').hidden = !reg && !canReg;
  $('#err').textContent = '';
}
$('#sw').onclick = () => { reg = !reg; location.hash = reg ? '#register' : ''; render(); };
window.addEventListener('hashchange', () => { reg = location.hash === '#register' && canReg; render(); });
fetch('/api/config').then(r => r.json()).then(c => { canReg = c.registration; if (!canReg) reg = false; render(); });
render();
$('#f').onsubmit = async ev => {
  ev.preventDefault();
  const err = m => { $('#err').textContent = m; };
  const pw = $('#p').value;
  if (reg) {
    if (pw.length < 8) return err('Пароль должен быть не короче 8 символов.');
    if (pw !== $('#p2').value) return err('Пароли не совпадают.');
  }
  $('#go').disabled = true;
  try {
    const r = await fetch(reg ? '/api/register' : '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('#n').value, email: $('#e').value, password: pw })
    });
    const d = await r.json();
    if (!r.ok) err(d.error || 'Ошибка. Попробуйте ещё раз.'); else location.href = '/';
  } catch (e) { err('Нет связи с сервером.'); }
  $('#go').disabled = false;
};
