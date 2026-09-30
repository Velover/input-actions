export interface ICameraInputModule {
	setInputEnabled: (enabled: boolean) => void;
	getRotation: (dt: number, disable_keyboard_rotation?: boolean) => Vector2;
	getZoomDelta: () => number;
	resetInputForFrameEnd: () => void;
}
