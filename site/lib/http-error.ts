/** An error a Route Handler turns into a JSON response with this status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
