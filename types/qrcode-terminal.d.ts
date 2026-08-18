declare module "qrcode-terminal/vendor/QRCode/index.js" {
    type QRCodeInstance = {
        addData(data: string): void;
        make(): void;
        getModuleCount(): number;
        isDark(row: number, col: number): boolean;
    };

    type QRCodeConstructor = new (typeNumber: number, errorCorrectLevel: number) => QRCodeInstance;

    const QRCode: QRCodeConstructor;
    export default QRCode;
}

declare module "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js" {
    const QRErrorCorrectLevel: {
        L: number;
        M: number;
        Q: number;
        H: number;
    };

    export default QRErrorCorrectLevel;
}
