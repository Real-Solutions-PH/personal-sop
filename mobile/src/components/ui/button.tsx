import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { forwardRef } from "react";
import { Pressable, type PressableProps, Text } from "react-native";

const buttonVariants = cva(
	"flex-row items-center justify-center rounded-md active:opacity-80",
	{
		variants: {
			variant: {
				default: "bg-primary",
				destructive: "bg-destructive",
				outline: "border border-input bg-background",
				secondary: "bg-secondary",
				ghost: "bg-transparent",
			},
			size: {
				default: "h-11 px-4",
				sm: "h-9 px-3",
				lg: "h-12 px-6",
				icon: "h-10 w-10",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

const buttonTextVariants = cva("text-sm font-medium", {
	variants: {
		variant: {
			default: "text-primary-foreground",
			destructive: "text-destructive-foreground",
			outline: "text-foreground",
			secondary: "text-secondary-foreground",
			ghost: "text-foreground",
		},
	},
	defaultVariants: { variant: "default" },
});

export interface ButtonProps
	extends PressableProps,
		VariantProps<typeof buttonVariants> {
	label?: string;
}

export const Button = forwardRef<
	React.ElementRef<typeof Pressable>,
	ButtonProps
>(({ className, variant, size, label, children, ...props }, ref) => (
	<Pressable
		ref={ref}
		className={cn(buttonVariants({ variant, size }), className)}
		{...props}
	>
		{label ? (
			<Text className={buttonTextVariants({ variant })}>{label}</Text>
		) : (
			children
		)}
	</Pressable>
));
Button.displayName = "Button";
