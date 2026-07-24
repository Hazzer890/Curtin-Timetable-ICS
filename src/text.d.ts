// wrangler.jsonc maps *.txt to the Text module type.
declare module "*.txt" {
  const content: string;
  export default content;
}
