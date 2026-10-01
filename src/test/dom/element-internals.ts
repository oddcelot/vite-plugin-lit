/**
 * Minimal `ElementInternals` for happy-dom, which has no `attachInternals`.
 * Web Awesome's form controls (`wa-button`, `wa-switch`, `wa-select`, …) read
 * validity and set form values through it on every update; without it they
 * throw. This stand-in keeps them valid and form-less, which is all the panel
 * tests need — real form behavior is covered by the e2e suite in a browser.
 */
if (!('attachInternals' in HTMLElement.prototype)) {
  class TestElementInternals {
    readonly states = new Set<string>();
    readonly form = null;
    readonly labels: Element[] = [];
    readonly willValidate = false;
    validationMessage = '';
    validity = {valid: true} as ValidityState;
    setFormValue(): void {}
    setValidity(flags: ValidityStateFlags = {}, message = ''): void {
      this.validity = {
        ...flags,
        valid: !Object.values(flags).some(Boolean),
      } as ValidityState;
      this.validationMessage = message;
    }
    checkValidity(): boolean {
      return this.validity.valid;
    }
    reportValidity(): boolean {
      return this.validity.valid;
    }
  }
  Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
    configurable: true,
    value(): TestElementInternals {
      return new TestElementInternals();
    },
  });
}
