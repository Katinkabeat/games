// Default container for sections on lobby/board pages.
// Light: white bg, purple-100 border, soft shadow.
// Dark:  #1a1130 bg, #2d1b55 border, no shadow (rely on contrast).
// Style spec: ../../../docs/sq-style-spec.md §5

export default function SQCard({ as: Tag = 'div', className = '', children, ...rest }) {
  const cls = `card ${className}`.trim();
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
