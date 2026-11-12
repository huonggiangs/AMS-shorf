// Test khong can kieu chat cho phan hoi JSON cua gateway: cho phep `await res.json()` tra any.
export {};
declare global {
  interface Response {
    json(): Promise<any>;
  }
}
