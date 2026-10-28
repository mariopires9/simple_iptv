// Outlined text field built from MUI's parts instead of `TextField`: `TextField` also imports
// `Select` (→ Menu, Popover, Modal…), and every MUI module lands in the eagerly loaded `mui`
// vendor chunk (vite.config.ts), which would push the initial bundle past its 200 KB budget.
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

export interface TextInputProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  /** Error text when `error`, otherwise a hint; linked with `aria-describedby`. */
  helperText?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
  htmlInput?: InputHTMLAttributes<HTMLInputElement>;
  endAdornment?: ReactNode;
}

export function TextInput({
  id,
  name,
  label,
  value,
  onChange,
  error = false,
  helperText,
  disabled,
  required,
  type = 'text',
  autoComplete,
  inputRef,
  htmlInput,
  endAdornment,
}: TextInputProps) {
  const helperId = `${id}-helper`;
  const hasHelper = helperText !== undefined && helperText !== '';
  return (
    <FormControl fullWidth error={error} disabled={disabled} required={required}>
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <OutlinedInput
        id={id}
        name={name}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        inputRef={inputRef}
        inputProps={{ ...htmlInput, 'aria-describedby': hasHelper ? helperId : undefined }}
        endAdornment={endAdornment}
      />
      {hasHelper && <FormHelperText id={helperId}>{helperText}</FormHelperText>}
    </FormControl>
  );
}
