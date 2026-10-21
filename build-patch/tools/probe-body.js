(() => {
  const text = document.body ? document.body.innerText : '';
  return JSON.stringify({ url: location.href, title: document.title, len: text.length, text: text.slice(0, 9000) });
})()
