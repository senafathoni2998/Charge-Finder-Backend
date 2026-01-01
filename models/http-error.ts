class HttpError extends Error {
  public code: number;

  constructor(message: string, errorCode: number) {
    super(message);
    this.code = errorCode;
  }
}
module.exports = HttpError;
