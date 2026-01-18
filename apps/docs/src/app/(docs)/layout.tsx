import { ContourBackground } from "@/components/ContourBackground/ContourBackground";

export default function Layout(props: LayoutProps<"/">) {
  return (
    <>
      <ContourBackground mouseParallax={0} gyroInfluence={0} speed={0.1} />
      {props.children}
    </>
  );
}
