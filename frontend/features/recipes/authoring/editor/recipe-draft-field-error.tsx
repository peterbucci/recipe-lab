interface RecipeDraftFieldErrorProps {
  id: string;
  message?: string;
}

export function RecipeDraftFieldError({ id, message }: RecipeDraftFieldErrorProps) {
  return message ? (
    <p id={id} className="recipe-form-field-error visually-hidden">
      {message}
    </p>
  ) : null;
}
