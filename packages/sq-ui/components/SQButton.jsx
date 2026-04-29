// SideQuest button. Three variants:
//   primary   — gradient purple, white text, raised shadow. CTAs.
//   secondary — white bg, purple border, purple text. Cancel / Recall.
//   danger    — rose bg, white text, raised shadow. Forfeit / Logout.
// Style spec: ../../../docs/sq-style-spec.md §5

const VARIANT_CLASS = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn-danger',
};

export default function SQButton({
  variant = 'primary',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = `${VARIANT_CLASS[variant] || VARIANT_CLASS.primary} ${className}`.trim();
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
