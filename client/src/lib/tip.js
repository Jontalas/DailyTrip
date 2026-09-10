/* Tooltip ligero como acción de Svelte:  use:tip={"texto"}
   Muestra una burbuja al pasar el ratón o al enfocar con teclado. Un único nodo
   reutilizado, posicionado en coordenadas de viewport (sirve sobre el mapa). */

let bubble = null;
let hideTimer = null;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement("div");
  bubble.className = "tip-bubble";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  document.body.appendChild(bubble);
  return bubble;
}

function show(target, text) {
  if (!text) return;
  clearTimeout(hideTimer);
  const b = ensureBubble();
  b.textContent = text;
  b.hidden = false;
  const r = target.getBoundingClientRect();
  // medir tras hacerlo visible
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
  let top = r.top - bh - 8;
  let below = false;
  if (top < 8) {
    top = r.bottom + 8;
    below = true;
  }
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
  b.dataset.below = below ? "1" : "0";
  b.classList.add("is-on");
}

function hide() {
  if (!bubble) return;
  bubble.classList.remove("is-on");
  hideTimer = setTimeout(() => {
    if (bubble) bubble.hidden = true;
  }, 120);
}

export function tip(node, text) {
  let current = text;
  const onEnter = () => show(node, current);
  const onLeave = () => hide();

  node.addEventListener("mouseenter", onEnter);
  node.addEventListener("mouseleave", onLeave);
  node.addEventListener("focus", onEnter);
  node.addEventListener("blur", onLeave);
  // accesibilidad: si no hay label, el texto sirve
  if (current && !node.getAttribute("aria-label") && !node.title) {
    node.setAttribute("aria-label", current);
  }

  return {
    update(next) {
      current = next;
      if (bubble && bubble.classList.contains("is-on")) show(node, current);
    },
    destroy() {
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", onLeave);
      node.removeEventListener("focus", onEnter);
      node.removeEventListener("blur", onLeave);
      hide();
    }
  };
}
