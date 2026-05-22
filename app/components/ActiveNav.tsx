type NavItem = [string, string, boolean?];

export function ActiveNav({ items, activePath }: { items: NavItem[]; activePath: string }) {
  return (
    <nav className="nav">
      {items.map(([href, label]) => {
        const active = href === "/" ? activePath === "/" : activePath === href || activePath.startsWith(`${href}/`);
        return (
        <a className={active ? "active" : undefined} href={href} key={href}>
          {label}
        </a>
        );
      })}
    </nav>
  );
}
