const menus = [...document.querySelectorAll('.site-header details')];

document.addEventListener('click', (event) => {
  for (const menu of menus) {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const openMenus = menus.filter((menu) => menu.open);
  openMenus.forEach((menu) => { menu.open = false; });
  openMenus.at(-1)?.querySelector('summary')?.focus();
});