/** Use the rendered surface so CSS zoom cannot scale pointer offsets twice. */
export function pointerPercent(position: number, origin: number, size: number) {
  return `${size > 0 ? ((position - origin) / size) * 100 : 50}%`;
}
