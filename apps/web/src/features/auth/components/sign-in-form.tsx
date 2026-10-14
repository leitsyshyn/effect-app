import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { signIn } from "@/lib/auth/client";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const defaultValues: z.infer<typeof signInSchema> = { email: "", password: "" };

export function SignInForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: signInSchema,
      onSubmitAsync: async ({ value }) => {
        const { error } = await signIn.email(value);
        return error?.message ?? error?.statusText;
      },
    },
    onSubmit: async () => {
      await queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey });
      await navigate({ to: "/" });
    },
  });

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your email and password to access your files.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="sign-in-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="email">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      autoComplete="email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="password">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="current-password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
              {(error) => <FieldError>{error}</FieldError>}
            </form.Subscribe>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" form="sign-in-form" className="w-full" disabled={isSubmitting}>
              Sign in
            </Button>
          )}
        </form.Subscribe>
        <p className="text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/sign-up" className="underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
