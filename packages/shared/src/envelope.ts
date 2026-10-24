// 统一响应信封：{code:0} 成功，非 0 失败。语义见 docs/02-architecture/api-spec.md §1
export interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

export const ok = <T>(data: T): Envelope<T> => ({ code: 0, msg: "", data });

export const fail = (code: number, msg: string): Envelope<never> => ({
  code,
  msg,
  data: null,
});

// 分页信封体（api-spec §1：?page=&page_size= → data:{list,total,page,page_size}）
export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}
