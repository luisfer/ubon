export function showMessage() {
  const out = document.getElementById('message');
  out.innerHTML = decodeURIComponent(location.hash.slice(1)); // expect-block: web/xss-html-sink
  out.textContent = location.hash.slice(1); // ok: textContent is not parsed as HTML
  out.innerHTML = ''; // ok: constant
}

export function renderList(items) {
  const list = document.querySelector('ul');
  list.insertAdjacentHTML('beforeend', `<li>${items[0].title}</li>`); // expect-warn: web/xss-html-sink
}
