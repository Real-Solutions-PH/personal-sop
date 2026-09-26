import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

export const Input = forwardRef<TextInput, TextInputProps>(
	({ className, placeholderTextColor = "#9ca3af", ...props }, ref) => (
		<TextInput
			ref={ref}
			placeholderTextColor={placeholderTextColor}
			className={cn(
				"h-11 rounded-md border border-input bg-background px-3 text-base text-foreground",
				className,
			)}
			{...props}
		/>
	),
);
Input.displayName = "Input";
